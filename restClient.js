const openshiftConfigLoader = require('openshift-config-loader');
const openshiftRestClient = require('openshift-rest-client');

const restClientSettings = {
    request: {
        strictSSL: false
    }
};
const client = Symbol('client');

/**
 * Creates an openshift rest client, takes config from the current OC
 */
class RestClientFactory
{
    constructor (){
        this[client] = null;
    }

    async getClient(){
        if (this[client] !== null){
            return this[client];
        }
        const openshiftConfig = await openshiftConfigLoader();
        this[client] = await openshiftRestClient(openshiftConfig, restClientSettings);
        return this[client];
    }
}

module.exports = new RestClientFactory();

