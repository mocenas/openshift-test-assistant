const nodeshift = require('nodeshift');
const request = require('supertest');

/**
 * Helper do work with (un)deploying applications to openshift.
 * It's statefull, works with the application deployed with deploy() method
 */
function OpenshiftTestAssistant(){
    this.retryLimit = 20;
    this.retryInterval = 5000; // in milliseconds
    this.ready=false;
    this.route="";
    this.config=null;
}

/**
 * Deploy application to openshift and wait until it's ready
 * @param config Deployment configuration
 * @returns {Promise<>} Promise fulfilled when app is ready, or rejected when when fail
 */
OpenshiftTestAssistant.prototype.deploy = function(config){
    let instance=this;
    this.config=config;
    return new Promise(function (fulfill, reject){
        nodeshift.deploy(config)
        .then(output => { // on success
            instance.route = "http://" + output.appliedResources.find(val => val.kind === "Route").spec.host;
            instance.waitForReady(instance.retryLimit)
            .then(() => {
                instance.ready=true;
                fulfill("");
            }).catch(reason => {
                reject(reason);
            });
        }).catch(reason => { // on failure
            reject(reason);
        });
    });
};

OpenshiftTestAssistant.prototype.getRoute = function(){
    return this.route;
};

OpenshiftTestAssistant.prototype.isReady = function (){
    return this.ready;
};

OpenshiftTestAssistant.prototype.undeploy = function(){
    this.ready=false;
    return nodeshift.undeploy(this.config);
};

/**
 * Wait for application to become ready
 * Readiness detected by return code - application considered ready when return 200
 * @param remainingTries
 * @returns {Promise<>}
 */
OpenshiftTestAssistant.prototype.waitForReady = function(remainingTries){
    let instance=this;
    return new Promise(function (fulfill, reject) {
        request(instance.route)
            .get('')
            .then(response => {
                if (response.status === 200) { // app ready
                    fulfill("");
                }
                else if (remainingTries > 0) { // app not ready, try another time
                    setTimeout(function () {
                        instance.waitForReady(remainingTries - 1)
                        .then(() => {
                            fulfill("");
                        }).catch(reason => {
                            reject(reason);
                        });
                    }, instance.retryInterval);
                }
                else { // app not ready, out of tries
                    reject("Timeout for app deploy");
                }
            })
            .catch(reason => { // failed to connect
                reject(reason);
            })
    });
};

module.exports = OpenshiftTestAssistant;

