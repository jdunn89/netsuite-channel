'use strict'

let InsertSalesOrder = function (ncUtil, channelProfile, flowContext, payload, callback) {
    const _ = require('lodash');
    const soap = require('strong-soap/src/soap');
    const nc = require('../util/common');

    let soapClient = null;

    let out = {
        ncStatusCode: null,
        payload: {}
    };

    let salesOrder = null;

    if (!callback) {
        throw new Error("A callback function was not provided");
    } else if (typeof callback !== 'function') {
        throw new TypeError("callback is not a function")
    }

    validateFunction()
        .then(getOrderRecord)
        .then(createSoapClient)
        .then(insertSalesOrder)
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
        else if (!channelProfile.salesOrderBusinessReferences)
            invalidMsg = "channelProfile.salesOrderBusinessReferences was not provided";
        else if (!nc.isArray(channelProfile.salesOrderBusinessReferences))
            invalidMsg = "channelProfile.salesOrderBusinessReferences is not an array";
        else if (!nc.isNonEmptyArray(channelProfile.salesOrderBusinessReferences))
            invalidMsg = "channelProfile.salesOrderBusinessReferences is empty";
        else if (!payload)
            invalidMsg = "payload was not provided";
        else if (!payload.doc)
            invalidMsg = "payload.doc was not provided";
        else if (!payload.doc.records)
            invalidMsg = "payload.doc.records was not provided";
        else if (!nc.isArray(payload.doc.records))
            invalidMsg = "payload.doc.records is not an array";
        else if (!nc.isNonEmptyArray(payload.doc.records))
            invalidMsg = "payload.doc.records is empty";

        if (invalidMsg) {
            logError(invalidMsg);
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${invalidMsg}]`);
        }
        logInfo("Function is valid.");
    }

    async function getOrderRecord() {
      return new Promise((resolve, reject) => {
        logInfo("Getting Sales Order Record...");
          payload.doc.records.forEach(function (record) {
            if (record.record.$attributes.$xsiType.type === "SalesOrder") {
              salesOrder = record;
            }
          });

          if (!salesOrder) {
            out.ncStatusCode = 400;
            reject("Sales Order Not Founds");
          } else {
            logInfo("Found Sales Orders");
            resolve(salesOrder);
          }
      });
    }

    function createSoapClient(record) {
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
            resolve(record);
          } else {
            reject(err);
          }
        });
      });
    }

    function insertSalesOrder(record) {
      return new Promise((resolve, reject) => {
        logInfo("Inserting Sales Order into NetSuite...");

        if (flowContext && flowContext.customForm) {
          record.record.customForm = {
            "$attributes": {
               "internalId": flowContext.customForm
            }
          }
        }

        let recordPayload = record;

        soapClient.add(recordPayload, function(err, result) {
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
      if (result.writeResponse) {
        if (result.writeResponse.status.$attributes.isSuccess === "true") {
          out.ncStatusCode = 201;
          out.payload.salesOrderRemoteID = result.writeResponse.baseRef.$attributes.internalId;
          out.payload.salesOrderBusinessReference = nc.extractBusinessReference(channelProfile.salesOrderBusinessReferences, salesOrder);
        } else {
          if (result.writeResponse.status.statusDetail) {
            out.ncStatusCode = 400;
            out.payload.error = result.writeResponse.status.statusDetail; //Array
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

module.exports.InsertSalesOrder = InsertSalesOrder;
