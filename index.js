const nodeshift = require('nodeshift');
const request = require('supertest');


const retryLimit = Symbol('retryLimit');
const retryInterval = Symbol('retryInterval');
const ready = Symbol('ready');
const route = Symbol('route');
const config = Symbol('config');

/**
 * Helper do work with (un)deploying applications to openshift.
 * It's statefull, works with the application deployed with deploy() method
 */
class OpenshiftTestAssistant{

    /**
     * @param configuration Deployment configuration
     */
    constructor(configuration){
        this[retryLimit] = 20;
        this[retryInterval] = 5000; // in milliseconds
        this[ready] = false;
        this[route] = '';
        this[config] = configuration;
    }

    /**
     * Deploy application to openshift and wait until it's ready
     * @returns {Promise<>} Promise fulfilled when app is ready, or rejected when when fail
     */
    deploy() {
        const instance = this;
        return new Promise(function (resolve, reject) {
            nodeshift.deploy(instance[config])
                .then(output => { // on success
                    instance[route] = 'http://' + output.appliedResources.find(val => val.kind === 'Route').spec.host;
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

    getRoute () {
        return this[route];
    };

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
}

module.exports = OpenshiftTestAssistant;
