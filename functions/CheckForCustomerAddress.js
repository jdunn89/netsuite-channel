'use strict'

let CheckForCustomerAddress = function (ncUtil, channelProfile, flowContext, payload, callback) {
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
        .then(searchForCustomerAddress)
        .then(checkResponse)
        .then(compareAddresses)
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
            invalidMsg = "channelProfile.channelSettingsValues.namespaces was not provided";
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

    function searchForCustomerAddress() {
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

    async function checkResponse(result) {
      return new Promise((resolve, reject) => {
        logInfo("Processing Response...");
        if (result.searchResult) {
          if (result.searchResult.status.$attributes.isSuccess === "true") {
            // recordList is only returned if there are results in the query
            if (result.searchResult.recordList) {
              if (!nc.isArray(result.searchResult.recordList.record)) {
                resolve(result.searchResult.recordList);
              } else {
                out.ncStatusCode = 400;
                reject("Multiple Customers Found");
              }
            } else {
              out.ncStatusCode = 400;
              reject("No Customer Found");
            }
          } else {
            if (result.searchResult.status.statusDetail) {
              out.ncStatusCode = 400;
              reject(result.searchResult.status.statusDetail);
            } else {
              out.ncStatusCode = 400;
              reject(result);
            }
          }
        } else {
          out.ncStatusCode = 500;
          reject(result);
        }
      });
    }

    async function compareAddresses(result) {
      logInfo("Comparing Addresses...");

      let resultCompare = null;
      let addressBook = [];

      if (!result.record.addressbookList.addressbook) {
        logInfo("204 - No customer addresses found");
        out.ncStatusCode = 204;
      } else {
        if (nc.isObject(result.record.addressbookList.addressbook)) {
          addressBook.push(result.record.addressbookList.addressbook);
          result.record.addressbookList.addressbook = addressBook;
        }

        let matchingAddresses = [];
        // Commenting out until multiple address IDs are supported
        //payload.doc.record.addressbookList.addressbook.forEach(function (addressbook) {
            let payloadCopy = JSON.parse(JSON.stringify(payload.doc));
            payloadCopy.record.addressbookList.addressbook = payload.doc.record.addressbookList.addressbook[0];
            let baseReference = nc.extractBusinessReference(channelProfile.customerAddressBusinessReferences, payloadCopy);
            result.record.addressbookList.addressbook.forEach(function (address) {
                let resultCopy = JSON.parse(JSON.stringify(result));
                resultCopy.record.addressbookList.addressbook = address;
                let addressReference = nc.extractBusinessReference(channelProfile.customerAddressBusinessReferences, resultCopy);
                if (addressReference === baseReference) {
                    matchingAddresses.push(address);
                }
            });
        //});

        if (matchingAddresses.length === 1) {
            logInfo("Found a matching address.");
            result.record.addressbookList.addressbook = matchingAddresses[0];
            out.ncStatusCode = 200;
            out.payload.customerAddressRemoteID = matchingAddresses[0].internalId;
            out.payload.customerAddressBusinessReference = nc.extractBusinessReference(channelProfile.customerAddressBusinessReferences, result);
        } else if (matchingAddresses.length === 0) {
            logInfo("No matching address found on customer.");
            out.ncStatusCode = 204;
        } else {
            out.payload.error = `Multiple Addresses Found: ${JSON.stringify(matchingAddresses, null, 2)}`;
            out.ncStatusCode = 409;
        }
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

module.exports.CheckForCustomerAddress = CheckForCustomerAddress;
