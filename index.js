const nodeshift = require('nodeshift');
const request = require('supertest');
const restClientFactory = require('./app/restClient');
const path = require('path');
const callsite = require('callsite');

const retryLimit = Symbol('retryLimit');
const retryInterval = Symbol('retryInterval');
const ready = Symbol('ready');
const config = Symbol('config');
const restClient = Symbol('restClient');

const route = Symbol('route');
const namespace = Symbol('namespace');
const applicationName =  Symbol('applicationName');

/**
 * Helper do work with (un)deploying applications to openshift.
 * It's stateful, works with the application deployed with deploy() method
 */
class OpenshiftTestAssistant{
    /**
     * @param configuration Deployment configuration, uses default if none provided
     */
    constructor(configuration){
        this[retryLimit] = 20;
        this[retryInterval] = 5000; // in milliseconds
        this[ready] = false;
        this[route] = '';
        this[restClient] = null;
        this[namespace] = '';
        this[applicationName] = '';

        // use custom config if provided, otherwise use default config
        this[config] = configuration || {
            'projectLocation': path.join(callsite()[1].getFileName(), '/../..'),
            'strictSSL': false
        };
    }

    /**
     * Deploy application to openshift and wait until it's ready
     * @returns {Promise<>} Promise fulfilled when app is ready, or rejected when when fail
     */
    deploy() {
        const instance = this;
        return new Promise(function (resolve, reject) {
            instance[ready] = false;
            nodeshift.deploy(instance[config])
                .then(output => { // on success
                    parseDeploymentOutput(instance, output);
                    instance.waitForReady(instance[retryLimit])
                        .then(() => {
                            instance[ready] = true;
                            resolve('');
                        }).catch(reason => {
                            reject(reason);
                    });
                }).catch(reason => { // on failure
                    reject(reason);
            });
        });
    };

    set retryLimit(newLimit){
        this[retryLimit]=newLimit;
    }

    get retryLimit(){
        return this[retryLimit];
    }

    get retryInterval () {
        return this[retryInterval];
    }

    set retryInterval (value) {
        this[retryInterval] = value;
    }

    async getRestClient (){
        if (this[restClient] === null){
            this[restClient] = await restClientFactory.getClient();
        }
        return this[restClient];
    }

    createRequest(){
        return request(this.getRoute())
    }

    getRoute () {
        return this[route];
    };

    get namespace () {
        return this[namespace];
    }

    get applicationName () {
        return this[applicationName];
    }

    isReady (){
        return this[ready];
    }

    undeploy () {
        this[ready] = false;
        return nodeshift.undeploy(this[config]);
    };

    /**
     * Wait for application to become ready
     * Readiness detected by return code - application considered ready when return 200
     * @param remainingTries
     * @returns {Promise<>}
     */
    waitForReady (remainingTries) {
        const instance = this;
        return new Promise(function (resolve, reject) {
            request(instance[route])
                .get('')
                .then(response => {
                    if (response.status === 200) { // app ready
                        resolve('');
                    } else if (remainingTries > 0) { // app not ready, try another time
                        setTimeout(function () {
                            instance.waitForReady(remainingTries - 1)
                                .then(() => {
                                    resolve('');
                                }).catch(reason => {
                                reject(reason);
                            });
                        }, instance[retryInterval]);
                    } else { // app not ready, out of tries
                        reject(new Error('Timeout for app deploy'));
                    }
                })
                .catch(reason => { // failed to connect
                    reject(reason);
                });
        });
    };

    /**
     * Change number of replicas for current deployment and wait for it to take effect
     * @param replicas number of desired pod replicas
     */
    async scale (replicas) {
        const instance=this;
        const restClient = await this.getRestClient();
        let deploymentConfig = await this.getDeploymentConfig();

        // update number of replicas
        deploymentConfig.spec.replicas = replicas;
        await restClient.deploymentconfigs.update('nodejs-configmap', deploymentConfig);

        // wait for update to take effect
        let remainingTries = this[retryLimit];
        return new Promise(async function (resolve, reject){
            do {
                if (--remainingTries === 0){
                    reject(new Error('Retry timeout'));
                }
                await instance.sleep(instance[retryInterval]);
                deploymentConfig = await instance.getDeploymentConfig();
            } while(deploymentConfig.status.availableReplicas !== replicas); // check available replicas field

            // wait for pods to become ready
            if (replicas > 0) {
                await instance.waitForReady(instance[retryLimit]);
            }
            resolve();
        });
    }

    /**
     * Get current deployment config from openshift
     * @returns deployment config
     */
    async getDeploymentConfig () {
        const restClient = await this.getRestClient();
        const deploymentConfigs= await restClient.deploymentconfigs.findAll();
        return deploymentConfigs.items.
            find(val => val.metadata.name === this[applicationName]
                && val.metadata.namespace === this[namespace]);
    }

    /**
     * Wait for certain condition to become true
     * waits for retryInterval * retryLimit until reject with timeout
     *
     * @param condition callback to function which defines the condition
     *      return true if condition is met, false otherwise
     * @returns {Promise<any>}
     */
    waitFor(condition) {
        const instance = this;
        let retryPeriod = instance[retryInterval];
        let remainingTries = instance[retryLimit];
        return new Promise(async (resolve, reject) => {
            let result = await condition();
            while(!result) {
                if (remainingTries-- === 0 ) {
                    reject(new Error('Timeout waiting for condition'))
                }
                await instance.sleep(retryPeriod);
                result = await condition();
            }
            resolve();
        });
    }

    /**
     * Return promise that will resolve after given time
     * @param ms What time to wait
     * @returns {Promise<any>}
     */
    sleep (ms) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
}

/**
 * Parse useful info from deployment output, store to the assistent's attributes
 * @param instance OpenshiftTestAssistent to store the parse info to
 * @param output Output from the deployment
 */
function parseDeploymentOutput (instance, output) {
    instance[route] = 'http://' + output.appliedResources.find(val => val.kind === 'Route').spec.host;
    instance[namespace] = output.appliedResources.find(val => val.kind === "DeploymentConfig").metadata.namespace;
    instance[applicationName] = output.appliedResources.find(val => val.kind === "DeploymentConfig").metadata.name;
}

module.exports = OpenshiftTestAssistant;
