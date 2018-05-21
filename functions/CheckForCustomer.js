'use strict'

let CheckForCustomer = function (ncUtil, channelProfile, flowContext, payload, callback) {
    const _ = require('lodash');
    const soap = require('strong-soap/src/soap');
    const jsonata = require('jsonata');
    const nc = require('../util/common');

    let soapClient = null;

    let out = {
        ncStatusCode: null,
        payload: {}
    };

    if (!callback) {
        throw new Error("A callback function was not provided");
    } else if (typeof callback !== 'function') {
        throw new TypeError("callback is not a function")
    }

    validateFunction()
        .then(createSoapClient)
        .then(searchForCustomer)
        .then(buildResponse)
        .catch(handleError)
        .then(() => callback(out))
        .catch(error => {
            logError(`The callback function threw an exception: ${error}`);
            setTimeout(() => {
                throw error;
            });
        });

    function logInfo(msg) {
        nc.log(msg, "info");
    }

    function logWarn(msg) {
        nc.log(msg, "warn");
    }

    function logError(msg) {
        nc.log(msg, "error");
    }

    async function validateFunction() {
        let messages = [];

        if (!ncUtil)
            messages.push("ncUtil was not provided");
        else if (!channelProfile)
            messages.push("channelProfile was not provided");
        else if (!channelProfile.channelSettingsValues)
            messages.push("channelProfile.channelSettingsValues was not provided");
        else if (!channelProfile.channelSettingsValues.namespaces)
            messages.push("channelProfile.channelSettingsValues.protocol was not provided");
        else if (!channelProfile.channelSettingsValues.wsdl_uri)
            messages.push("channelProfile.channelSettingsValues.api_uri was not provided");
        else if (!channelProfile.channelAuthValues)
            messages.push("channelProfile.channelAuthValues was not provided");
        else if (!channelProfile.channelAuthValues.account)
            messages.push("channelProfile.channelAuthValues.account was not provided");
        else if (!channelProfile.channelAuthValues.consumerKey)
            messages.push("channelProfile.channelAuthValues.consumerKey was not provided");
        else if (!channelProfile.channelAuthValues.consumerSecret)
            messages.push("channelProfile.channelAuthValues.consumerSecret was not provided");
        else if (!channelProfile.channelAuthValues.tokenID)
            messages.push("channelProfile.channelAuthValues.tokenID was not provided");
        else if (!channelProfile.channelAuthValues.tokenSecret)
            messages.push("channelProfile.channelAuthValues.tokenSecret was not provided");
        else if (!channelProfile.customerBusinessReferences)
            messages.push("channelProfile.customerBusinessReferences was not provided");
        else if (!nc.isArray(channelProfile.customerBusinessReferences))
            messages.push("channelProfile.customerBusinessReferences is not an array");
        else if (!nc.isNonEmptyArray(channelProfile.customerBusinessReferences))
            messages.push("channelProfile.customerBusinessReferences is empty");
        else if (!payload)
            messages.push("payload was not provided");
        else if (!payload.doc)
            messages.push("payload.doc was not provided");

        if (messages.length > 0) {
            messages.forEach(msg => logError(msg));
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${messages.join(", ")}]`);
        }
        logInfo("Function is valid.");
    }

    async function createSoapClient() {
      return new Promise((resolve, reject) => {
        logInfo("Creating NetSuite Client...");
        soap.createClient(channelProfile.channelSettingsValues.wsdl_uri, {}, function(err, client) {
          if (!err) {
            // Add namespaces to the wsdl
            _.assign(client.wsdl.definitions.xmlns, channelProfile.channelSettingsValues.namespaces);
            client.wsdl.xmlnsInEnvelope = client.wsdl._xmlnsMap();

            let headers = nc.generateHeaders(channelProfile);
            client.addSoapHeader(headers);

            soapClient = client;
            resolve();
          } else {
            reject(err);
          }
        });
      });
    }

    async function searchForCustomer() {
      return new Promise((resolve, reject) => {
        logInfo("Searching NetSuite for existing customer...");

        let searchPayload = {
          "searchRecord": {
            "$attributes": {
              "$xsiType": {
                "xmlns": channelProfile.channelSettingsValues.namespaces.listRel,
                "type": "CustomerSearch"
              }
            },
            "basic":{}
          }
        };

        channelProfile.customerBusinessReferences.forEach(function (businessReference) {
            let expression = jsonata(businessReference);
            let value = expression.evaluate(payload.doc);
            let netsuiteValue = businessReference.split('.').pop();

            if (!value) {
              logWarn(`Customer business reference '${businessReference}' is missing or has no value.`);
            }

            // Note that certain fields can only use certain operators
            // An operator of 'is' on the 'email' will work but will not on others
            searchPayload["searchRecord"]["basic"][netsuiteValue] = {
              "$attributes": {
                "operator": "is"
              },
              "searchValue": value
            }
        });

        soapClient.search(searchPayload, function(err, result) {
          if (!err) {
            resolve(result);
          } else {
            reject(err);
          }
        });
      });
    }

    async function buildResponse(result) {
      if (result.searchResult) {
        if (result.searchResult.status.$attributes.isSuccess === "true") {
          // recordList is only returned if there are results in the query
          if (result.searchResult.recordList) {
            if (nc.isObject(result.searchResult.recordList.record)) {
              out.ncStatusCode = 200;
              out.payload.customerRemoteID = result.searchResult.recordList.record.$attributes.internalId,
              out.payload.customerBusinessReference = nc.extractBusinessReference(channelProfile.customerBusinessReferences, result.searchResult.recordList)
            } else {
              out.ncStatusCode = 409;
            }
          } else {
            out.ncStatusCode = 204;
          }
        } else {
          if (result.searchResult.status.statusDetail) {
            out.ncStatusCode = 400;
            out.payload.error = result.searchResult.status.statusDetail;
          } else {
            out.ncStatusCode = 400;
            out.payload.error = result;
          }
        }
      } else {
        out.ncStatusCode = 400;
        out.payload.error = result;
      }
    }

    async function handleError(error) {
        if (error.response) {
          let err = String(error.response.body);

          if (err.indexOf("soapenv:Fault") !== -1) {
            if (err.indexOf("platformFaults:exceededConcurrentRequestLimitFault") !== -1) {
              logError(`Concurrency Request Limit Exceeded: ${err}`);
              out.ncStatusCode = 429;
              out.payload.error = error;
            } else if (err.indexOf("platformFaults:exceededRequestLimitFault") !== -1) {
              logError(`Request Limit Exceeded: ${err}`);
              out.ncStatusCode = 429;
              out.payload.error = error;
            } else {
              logError(`SOAP Fault Found: ${err}`);
              out.ncStatusCode = 400;
              out.payload.error = error;
            }
          } else {
            out.ncStatusCode = 500;
            out.payload.error = error;
          }
        } else {
          out.payload.error = error;
          out.ncStatusCode = out.ncStatusCode || 500;
        }
    }
}

module.exports.CheckForCustomer = CheckForCustomer;
