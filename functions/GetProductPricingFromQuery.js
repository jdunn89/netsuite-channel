'use strict'

let GetProductPricingFromQuery = function(ncUtil, channelProfile, flowContext, payload, callback) {
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
        .then(buildRequest)
        .then(createSoapClient)
        .then(callNetsuite)
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
        else if (!channelProfile.productPricingBusinessReferences)
            invalidMsg = "channelProfile.productPricingBusinessReferences was not provided";
        else if (!nc.isArray(channelProfile.productPricingBusinessReferences))
            invalidMsg = "channelProfile.productPricingBusinessReferences is not an array";
        else if (!nc.isNonEmptyArray(channelProfile.productPricingBusinessReferences))
            invalidMsg = "channelProfile.productPricingBusinessReferences is empty";
        else if (!payload)
            invalidMsg = "payload was not provided";
        else if (!payload.doc)
            invalidMsg = "payload.doc was not provided";
        else if (!payload.doc.remoteIDs && !payload.doc.searchFields && !payload.doc.modifiedDateRange)
            invalidMsg = "either payload.doc.remoteIDs or payload.doc.searchFields or payload.doc.modifiedDateRange must be provided";
        else if (payload.doc.remoteIDs && (payload.doc.searchFields || payload.doc.modifiedDateRange))
            invalidMsg = "only one of payload.doc.remoteIDs or payload.doc.searchFields or payload.doc.modifiedDateRange may be provided";
        else if (payload.doc.remoteIDs && (!Array.isArray(payload.doc.remoteIDs) || payload.doc.remoteIDs.length === 0))
            invalidMsg = "payload.doc.remoteIDs must be an Array with at least 1 remoteID";
        else if (payload.doc.searchFields && (!Array.isArray(payload.doc.searchFields) || payload.doc.searchFields.length === 0))
            invalidMsg = "payload.doc.searchFields must be an Array with at least 1 key value pair: {searchField: 'key', searchValues: ['value_1']}";
        else if (payload.doc.searchFields) {
          for (let i = 0; i < payload.doc.searchFields.length; i++) {
            if (!payload.doc.searchFields[i].searchField || !Array.isArray(payload.doc.searchFields[i].searchValues) || payload.doc.searchFields[i].searchValues.length === 0) {
              invalidMsg = "payload.doc.searchFields[" + i + "] must be a key value pair: {searchField: 'key', searchValues: ['value_1']}";
              break;
            }
          }
        }
        else if (payload.doc.modifiedDateRange && !(payload.doc.modifiedDateRange.startDateGMT || payload.doc.modifiedDateRange.endDateGMT))
            invalidMsg = "at least one of payload.doc.modifiedDateRange.startDateGMT or payload.doc.modifiedDateRange.endDateGMT must be provided";
        else if (payload.doc.modifiedDateRange && payload.doc.modifiedDateRange.startDateGMT && payload.doc.modifiedDateRange.endDateGMT && (payload.doc.modifiedDateRange.startDateGMT > payload.doc.modifiedDateRange.endDateGMT))
            invalidMsg = "startDateGMT must have a date before endDateGMT";

        if (invalidMsg) {
            logError(invalidMsg);
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${invalidMsg}]`);
        }
        logInfo("Function is valid.");
    }

    async function buildRequest() {
        logInfo("Building NetSuite Request...");

        let searchPayload = {
          "searchRecord": {
            "$attributes": {
              "$xsiType": {
                "xmlns": channelProfile.channelSettingsValues.namespaces.listAcct,
                "type": "ItemSearch"
              }
            },
            "basic":{
              "type": {
                "$attributes": {
                  "operator": "anyOf"
                },
                "$value": {
                  "searchValue": "inventoryItem"
                }
              }
            }
          }
        };

        if (flowContext) {
          // Flow Context Criteria Filters
          if (flowContext.filterField && flowContext.filterCriteria) {
            let fieldName = flowContext.filterField;

            let customField = fieldName.startsWith("custitem");

            if (customField) {
              searchPayload["searchRecord"]["basic"]["customFieldList"] = {
                "customField": []
              }

              let obj = {
                "$attributes": {
                  "$xsiType": {
                    "xmlns": channelProfile.channelSettingsValues.namespaces.platformCore,
                    "type": "SearchBooleanCustomField"
                  },
                  "scriptId": flowContext.filterField
                },
                "searchValue": flowContext.filterCriteria
              }

              if (flowContext.filterCompare) {
                obj["$attributes"]["operator"] = flowContext.filterCompare;
              }

              searchPayload["searchRecord"]["basic"]["customFieldList"]["customField"].push(obj);

            } else {
              searchPayload["searchRecord"]["basic"][fieldName] = {
                "searchValue": flowContext.filterCriteria
              }

              if (flowContext.filterCompare) {
                searchPayload["searchRecord"]["basic"][fieldName]["$attributes"] = {
                  "operator": flowContext.filterCompare
                }
              }
            }
          }
        }

        if (payload.doc.pagingContext) {
          searchPayload = {
            "searchId": payload.doc.pagingContext.searchId,
            "pageIndex": payload.doc.pagingContext.index
          }
          return searchPayload;
        }

        if (payload.doc.searchFields) {

          payload.doc.searchFields.forEach(function (searchField) {
            let fieldName = searchField.searchField;

            searchPayload["searchRecord"]["basic"][fieldName] = {
              "$attributes": {
                "operator": "anyOf"
              },
              "searchValue": searchField.searchValues
            }
          });

        } else if (payload.doc.remoteIDs) {

          let values = [];

          payload.doc.remoteIDs.forEach(function (remoteID) {
            values.push({ "$attributes": { "internalId": remoteID } });
          });

          searchPayload["searchRecord"]["basic"]["internalId"] = {
            "$attributes": {
              "operator": "anyOf"
            },
            "searchValue": values
          }

        } else if (payload.doc.modifiedDateRange) {

          let obj = {};

          if (payload.doc.modifiedDateRange.startDateGMT && !payload.doc.modifiedDateRange.endDateGMT) {
            obj = {
              "$attributes": {
                "operator": "onOrAfter"
              },
              "searchValue": new Date(Date.parse(payload.doc.modifiedDateRange.startDateGMT) - 1).toISOString()
            }
          } else if (payload.doc.modifiedDateRange.endDateGMT && !payload.doc.modifiedDateRange.startDateGMT) {
            obj = {
              "$attributes": {
                "operator": "onOrBefore"
              },
              "searchValue": new Date(Date.parse(payload.doc.modifiedDateRange.endDateGMT) + 1).toISOString()
            }
          } else if (payload.doc.modifiedDateRange.startDateGMT && payload.doc.modifiedDateRange.endDateGMT) {
            obj = {
              "$attributes": {
                "operator": "within"
              },
              "searchValue": new Date(Date.parse(payload.doc.modifiedDateRange.startDateGMT) - 1).toISOString(),
              "searchValue2": new Date(Date.parse(payload.doc.modifiedDateRange.endDateGMT) + 1).toISOString()
            }
          }

          searchPayload["searchRecord"]["basic"]["lastModifiedDate"] = obj;
        }

        return searchPayload;
    }

    function createSoapClient(search) {
      return new Promise((resolve, reject) => {
        logInfo("Creating NetSuite Client...");
        soap.createClient(channelProfile.channelSettingsValues.wsdl_uri, {}, function(err, client) {
          if (!err) {
            // Add namespaces to the wsdl
            _.assign(client.wsdl.definitions.xmlns, channelProfile.channelSettingsValues.namespaces);
            client.wsdl.xmlnsInEnvelope = client.wsdl._xmlnsMap();

            let headers = nc.generateHeaders(channelProfile, payload.doc.pageSize);
            client.addSoapHeader(headers);

            soapClient = client;
            resolve(search);
          } else {
            reject(err);
          }
        });
      });
    }

    function callNetsuite(searchPayload) {
      return new Promise((resolve, reject) => {
        logInfo("Calling NetSuite...");
        let operation = "search"

        if (searchPayload.searchId) {
          operation = "searchMoreWithId"
        }

        soapClient.clearSoapHeaders();
        let headers = nc.generateHeaders(channelProfile, payload.doc.pageSize);
        soapClient.addSoapHeader(headers);

        soapClient[operation](searchPayload, function(err, result) {
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
      if (result.searchResult) {
        if (result.searchResult.status.$attributes.isSuccess === "true") {
          let docs = [];

          // recordList is only returned if there are results in the query
          if (result.searchResult.recordList) {
            if (nc.isObject(result.searchResult.recordList.record)) {
              let product = {
                record: result.searchResult.recordList.record
              };
              docs.push({
                doc: product,
                productPricingRemoteID: product.record.$attributes.internalId,
                productPricingBusinessReference: nc.extractBusinessReference(channelProfile.productPricingBusinessReferences, product)
              });
            } else {
              for (let i = 0; i < result.searchResult.recordList.record.length; i++) {
                let product = {
                  record: result.searchResult.recordList.record[i]
                };
                docs.push({
                  doc: product,
                  productPricingRemoteID: product.record.$attributes.internalId,
                  productPricingBusinessReference: nc.extractBusinessReference(channelProfile.productPricingBusinessReferences, product)
                });
              }
            }

            out.payload = docs;

            if (result.searchResult.pageIndex < result.searchResult.totalPages) {
              payload.doc.pagingContext = {
                searchId: result.searchResult.searchId,
                index: result.searchResult.pageIndex + 1
              }

              out.ncStatusCode = 206;
            } else {
              out.ncStatusCode = 200;
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

module.exports.GetProductPricingFromQuery = GetProductPricingFromQuery;
