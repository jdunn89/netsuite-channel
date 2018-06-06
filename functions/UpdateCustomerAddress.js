'use strict'

let UpdateCustomerAddress = function (ncUtil, channelProfile, flowContext, payload, callback) {
    const _ = require('lodash');
    const soap = require('strong-soap/src/soap');
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
        .then(updateCustomerAddress)
        .then(getUpdatedAddresses)
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
        let invalidMsg;

        if (!ncUtil)
            invalidMsg = "ncUtil was not provided";
        else if (!channelProfile)
            invalidMsg = "channelProfile was not provided";
        else if (!channelProfile.channelSettingsValues)
            invalidMsg = "channelProfile.channelSettingsValues was not provided";
        else if (!channelProfile.channelSettingsValues.namespaces)
            invalidMsg = "channelProfile.channelSettingsValues.protocol was not provided";
        else if (!channelProfile.channelSettingsValues.wsdl_uri)
            invalidMsg = "channelProfile.channelSettingsValues.api_uri was not provided";
        else if (!channelProfile.channelAuthValues)
            invalidMsg = "channelProfile.channelAuthValues was not provided";
        else if (!channelProfile.channelAuthValues.account)
            invalidMsg = "channelProfile.channelAuthValues.account was not provided";
        else if (!channelProfile.channelAuthValues.consumerKey)
            invalidMsg = "channelProfile.channelAuthValues.consumerKey was not provided";
        else if (!channelProfile.channelAuthValues.consumerSecret)
            invalidMsg = "channelProfile.channelAuthValues.consumerSecret was not provided";
        else if (!channelProfile.channelAuthValues.tokenID)
            invalidMsg = "channelProfile.channelAuthValues.tokenID was not provided";
        else if (!channelProfile.channelAuthValues.tokenSecret)
            invalidMsg = "channelProfile.channelAuthValues.tokenSecret was not provided";
        else if (!channelProfile.customerBusinessReferences)
            invalidMsg = "channelProfile.customerBusinessReferences was not provided";
        else if (!nc.isArray(channelProfile.customerBusinessReferences))
            invalidMsg = "channelProfile.customerBusinessReferences is not an array";
        else if (!nc.isNonEmptyArray(channelProfile.customerBusinessReferences))
            invalidMsg = "channelProfile.customerBusinessReferences is empty";
        else if (!payload)
            invalidMsg = "payload was not provided";
        else if (!payload.doc)
            invalidMsg = "payload.doc was not provided";

        if (invalidMsg) {
            logError(invalidMsg);
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${invalidMsg}]`);
        }
        logInfo("Function is valid.");
    }

    function createSoapClient() {
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

    function updateCustomerAddress() {
      return new Promise((resolve, reject) => {
        logInfo("Searching NetSuite for existing customer...");

        let recordPayload = {
          "record": {
            "$attributes": {
              "internalId": payload.customerRemoteID,
              "$xsiType": {
                "xmlns": channelProfile.channelSettingsValues.namespaces.listRel,
                "type": "Customer"
              }
            },
            "$value": payload.doc
          }
        }

        soapClient.update(recordPayload, function(err, result) {
          if (!err) {
            resolve(result);
          } else {
            reject(err);
          }
        });
      });
    }

    async function checkResponse(result) {
      return new Promise((resolve, reject) => {
        if (result.writeResponse) {
          if (result.writeResponse.status.$attributes.isSuccess === "true") {
              resolve(result);
          } else {
            if (result.writeResponse.status.statusDetail) {
              out.ncStatusCode = 400;
              reject(result.writeResponse.status.statusDetail);
            } else {
              out.ncStatusCode = 400;
              reject(result);
            }
          }
        } else {
          out.ncStatusCode = 400;
          reject(result);
        }
      });
    }

    async function getUpdatedAddresses(customerResult) {
      return new Promise((resolve, reject) => {
        logInfo("Retrieving Updated Addresses...");

        let getPayload = {
          "baseRef": {
            "$attributes": {
              "$xsiType": {
                "xmlns": channelProfile.channelSettingsValues.namespaces.platformCore,
                "type": "RecordRef"
              },
              "internalId": customerResult.writeResponse.baseRef.$attributes.internalId,
              "type": "customer"
            }
          }
        };

        soapClient.clearSoapHeaders();
        let headers = nc.generateHeaders(channelProfile);
        soapClient.addSoapHeader(headers);

        soapClient.get(getPayload, function(err, result) {
          if (!err) {
            resolve(result);
          } else {
            reject(err);
          }
        });
      });
    }

    async function buildResponse(result) {
      logInfo("Processing Response...");
      if (result.readResponse) {
        if (result.readResponse.status.$attributes.isSuccess === "true") {
          for (let i = 0; i < result.readResponse.record.addressbookList.addressbook.length; i++) {
            if (result.readResponse.record.addressbookList.addressbook[i].internalId == payload.customerAddressRemoteID) {
              result.readResponse.record.addressbookList.addressbook = result.readResponse.record.addressbookList.addressbook[i];
              break;
            }
          };

          out.ncStatusCode = 200;
          out.payload.customerAddressBusinessReference = nc.extractBusinessReference(channelProfile.customerAddressBusinessReferences, result.readResponse);
        } else {
          if (result.readResponse.status.statusDetail) {
            out.ncStatusCode = 400;
            out.payload.error = result.readResponse.status.statusDetail;
          } else {
            out.ncStatusCode = 400;
            out.payload.error = result;
          }
        }
      } else {
        out.ncStatusCode = 500;
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

module.exports.UpdateCustomerAddress = UpdateCustomerAddress;
