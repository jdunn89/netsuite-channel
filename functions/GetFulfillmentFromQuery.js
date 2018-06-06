'use strict'

let GetFulfillmentFromQuery = function(ncUtil, channelProfile, flowContext, payload, callback) {
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
        .then(buildFulfillmentRequest)
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
        else if (!channelProfile.fulfillmentBusinessReferences)
            messages.push("channelProfile.fulfillmentBusinessReferences was not provided");
        else if (!nc.isArray(channelProfile.fulfillmentBusinessReferences))
            messages.push("channelProfile.fulfillmentBusinessReferences is not an array");
        else if (!nc.isNonEmptyArray(channelProfile.fulfillmentBusinessReferences))
            messages.push("channelProfile.fulfillmentBusinessReferences is empty");
        else if (!payload)
            messages.push("payload was not provided");
        else if (!payload.doc)
            messages.push("payload.doc was not provided");
        else if (!payload.salesOrderRemoteID)
            messages.push("payload.salesOrderRemoteID was not provided");
        else if (!payload.doc.remoteIDs && !payload.doc.searchFields && !payload.doc.modifiedDateRange)
            messages.push("either payload.doc.remoteIDs or payload.doc.searchFields or payload.doc.modifiedDateRange must be provided");
        else if (payload.doc.remoteIDs && (payload.doc.searchFields || payload.doc.modifiedDateRange))
            messages.push("only one of payload.doc.remoteIDs or payload.doc.searchFields or payload.doc.modifiedDateRange may be provided");
        else if (payload.doc.remoteIDs && (!Array.isArray(payload.doc.remoteIDs) || payload.doc.remoteIDs.length === 0))
            messages.push("payload.doc.remoteIDs must be an Array with at least 1 remoteID");
        else if (payload.doc.searchFields && (!Array.isArray(payload.doc.searchFields) || payload.doc.searchFields.length === 0))
            messages.push("payload.doc.searchFields must be an Array with at least 1 key value pair: {searchField: 'key', searchValues: ['value_1']}");
        else if (payload.doc.searchFields) {
          for (let i = 0; i < payload.doc.searchFields.length; i++) {
            if (!payload.doc.searchFields[i].searchField || !Array.isArray(payload.doc.searchFields[i].searchValues) || payload.doc.searchFields[i].searchValues.length === 0)
              messages.push("payload.doc.searchFields[" + i + "] must be a key value pair: {searchField: 'key', searchValues: ['value_1']}");
              break;
            }
          }
        else if (payload.doc.modifiedDateRange && !(payload.doc.modifiedDateRange.startDateGMT || payload.doc.modifiedDateRange.endDateGMT))
            messages.push("at least one of payload.doc.modifiedDateRange.startDateGMT or payload.doc.modifiedDateRange.endDateGMT must be provided");
        else if (payload.doc.modifiedDateRange && payload.doc.modifiedDateRange.startDateGMT && payload.doc.modifiedDateRange.endDateGMT && (payload.doc.modifiedDateRange.startDateGMT > payload.doc.modifiedDateRange.endDateGMT))
            messages.push("startDateGMT must have a date before endDateGMT");

        if (messages.length > 0) {
            messages.forEach(msg => logError(msg));
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${messages.join(", ")}]`);
        }
        logInfo("Function is valid.");
    }

    async function buildFulfillmentRequest() {
        logInfo("Building NetSuite Fulfillment Request...");

        let searchPayload = {
          "searchRecord": {
            "$attributes": {
              "$xsiType": {
                "xmlns": channelProfile.channelSettingsValues.namespaces.tranSales,
                "type": "TransactionSearch"
              }
            },
            "basic": {
              "type": {
                "$attributes": {
                  "operator": "anyOf"
                },
                "$value": {
                  "searchValue": "itemFulfillment"
                }
              }
            }
          }
        };

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

        if (flowContext) {
          if (flowContext.entity_id) {
            let obj = {
              "$attributes": {
                "operator": "anyOf"
              },
              "searchValue": {
                "$attributes": {
                  "internalId": flowContext.entity_id
                }
              }
            }

            searchPayload["searchRecord"]["basic"]["entity"] = obj;
          }

          if (flowContext.created_at) {
            let obj = {
              "$attributes": {
                "operator": "on"
              },
              "searchValue": flowContext.created_at
            }

            searchPayload["searchRecord"]["basic"]["lastModifiedDate"] = obj;
          }

          if (flowContext.updated_at) {
            let obj = {
              "$attributes": {
                "operator": "on"
              },
              "searchValue": flowContext.updated_at
            }

            searchPayload["searchRecord"]["basic"]["dateCreated"] = obj;
          }
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

            soapClient = client;
            resolve(search);
          } else {
            reject(err);
          }
        });
      });
    }

    function callNetsuite(netsuitePayload) {
      return new Promise((resolve, reject) => {
        logInfo("Calling NetSuite...");

        soapClient.clearSoapHeaders();
        let headers = nc.generateHeaders(channelProfile, payload.doc.pageSize);
        soapClient.addSoapHeader(headers);

        let operation;

        if (netsuitePayload.searchId) {
          operation = "searchMoreWithId"
        } else if (netsuitePayload.record) {
          operation = "get"
        } else {
          operation = "search"
        }
        soapClient[operation](netsuitePayload, function(err, result) {
          if (!err) {
            resolve(result);
          } else {
            reject(err);
          }
        });
      });
    }

    async function buildOrderLookupRequest(obj) {
      logInfo(`Item Fulfillment internalId: ${obj.record.$attributes.internalId}. Lookup up sales order...`);
      logInfo(`${obj.record.createdFrom.name}:${obj.record.createdFrom.$attributes.internalId}`);
      let getPayload = {
        "record":{
           "$attributes":{
              "$xsiType":{
                 "xmlns": channelProfile.channelSettingsValues.namespaces.platformCore,
                 "type": "RecordRef"
              },
              "internalId": obj.record.createdFrom.$attributes.internalId,
              "type": "salesOrder"
           }
         }
      }

      return getPayload;
    }

    async function processOrderLookupResult(orderResult) {
      logInfo("Processing Order Lookup Result...");
      if (orderResult.readResponse) {
        if (orderResult.readResponse.status.$attributes.isSuccess === "true") {
          return orderResult.readResponse.record.tranId;
        } else {
          if (orderResult.readResponse.status.statusDetail) {
            out.ncStatusCode = 400;
            out.payload.error = orderResult.readResponse.status.statusDetail;
            throw new Error(JSON.stringify(orderResult.readResponse.status.statusDetail));
          } else {
            out.ncStatusCode = 400;
            out.payload.error = orderResult;
            throw new Error(JSON.stringify(orderResult.readResponse.status.statusDetail));
          }
        }
      } else {
        out.ncStatusCode = 400;
        out.payload.error = orderResult;
        throw new Error(orderResult.readResponse.status.statusDetail);
      }
    }

    async function buildResponse(result) {
      return new Promise((resolve, reject) => {
        logInfo("Processing Response...");
        if (result.searchResult) {
          if (result.searchResult.status.$attributes.isSuccess === "true") {
            let docs = [];

            // recordList is only returned if there are results in the query
            if (result.searchResult.recordList) {
              function processResult() {
                return new Promise((pResolve, pReject) => {
                  if (nc.isObject(result.searchResult.recordList.record)) {
                    let validShipStatus = true;

                    if (flowContext && flowContext.shipStatus) {
                      if (result.searchResult.recordList.record.shipStatus !== flowContext.shipStatus) {
                        validShipStatus = false;
                      }
                    }

                    if (validShipStatus) {
                      if (!result.searchResult.recordList.record.createdFrom) {
                        logInfo("Fulfillment does not have a 'createdFrom' field. Skipping.");
                        pResolve();
                      } else {
                        buildOrderLookupRequest(result.searchResult.recordList)
                          .then(callNetsuite)
                          .then(processOrderLookupResult)
                          .then((orderNumber) => {
                            docs.push({
                              doc: result.searchResult.recordList,
                              fulfillmentRemoteID: result.searchResult.recordList.record.$attributes.internalId,
                              salesOrderRemoteID: result.searchResult.recordList.record.createdFrom.$attributes.internalId,
                              salesOrderBusinessReference: orderNumber
                            });
                            pResolve();
                          })
                          .catch((err) => {
                            logError('Failed to retrieve Order Number: ' + err);
                            pReject(err);
                          });
                      }
                    } else {
                      logInfo(`Fulfillment does not have a 'shipStatus' of ${flowContext.shipStatus}`);
                      pResolve();
                    }
                  } else {
                    let promises = [];
                    for (let i = 0, p = Promise.resolve(); i < result.searchResult.recordList.record.length; i++) {
                      let fulfillment = {
                        record: result.searchResult.recordList.record[i]
                      };
                      p = p.then(_ => new Promise((oResolve, oReject) => {
                        let validShipStatus = true;

                        if (flowContext && flowContext.shipStatus) {
                          if (result.searchResult.recordList.record[i].shipStatus !== flowContext.shipStatus) {
                            validShipStatus = false;
                          }
                        }

                        if (validShipStatus) {
                          if (!fulfillment.record.createdFrom) {
                            logInfo("Fulfillment does not have a 'createdFrom' field. Skipping.");
                            oResolve();
                          } else {
                            buildOrderLookupRequest(fulfillment)
                              .then(callNetsuite)
                              .then(processOrderLookupResult)
                              .then((orderNumber) => {
                                docs.push({
                                  doc: fulfillment,
                                  fulfillmentRemoteID: fulfillment.record.$attributes.internalId,
                                  salesOrderRemoteID: fulfillment.record.createdFrom.$attributes.internalId,
                                  salesOrderBusinessReference: orderNumber
                                });
                              })
                              .then(() => {
                                oResolve();
                              })
                              .catch((err, test) => {
                                logError('Failed to retrieve Order Number: ' + err);
                                oReject(err);
                              });
                          }
                        } else {
                          logInfo(`Fulfillment does not have a 'shipStatus' of ${flowContext.shipStatus}`);
                          oResolve();
                        }
                      }));
                      promises.push(p);
                    }

                    Promise.all(promises).then(() => {
                      pResolve();
                    }).catch((err) => {
                      pReject(err);
                    });
                  }
                });
              }

              processResult().then(() => {
                if (result.searchResult.pageIndex < result.searchResult.totalPages) {
                  payload.doc.pagingContext = {
                    searchId: result.searchResult.searchId,
                    index: result.searchResult.pageIndex + 1
                  }

                  out.ncStatusCode = 206;
                  out.payload = docs;
                } else if (docs.length == 0){
                  out.ncStatusCode = 204;
                } else {
                  out.ncStatusCode = 200;
                  out.payload = docs;
                }
                resolve();
              }).catch((err) => {
                out.ncStatusCode = 400;
                out.payload.error = err;
                reject(err);
              });
            } else {
              out.ncStatusCode = 204;
              out.payload = result;
              resolve();
            }
          } else {
            if (result.searchResult.status.statusDetail) {
              out.ncStatusCode = 400;
              out.payload.error = result.searchResult.status.statusDetail;
              reject(result.searchResult.status.statusDetail);
            } else {
              out.ncStatusCode = 400;
              out.payload.error = result;
              reject(result);
            }
          }
        } else {
          out.ncStatusCode = 400;
          out.payload.error = result;
          reject(result);
        }
      });
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

module.exports.GetFulfillmentFromQuery = GetFulfillmentFromQuery;
