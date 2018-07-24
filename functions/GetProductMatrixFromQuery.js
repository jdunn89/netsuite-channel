'use strict'

let GetProductMatrixFromQuery = function(ncUtil, channelProfile, flowContext, payload, callback) {
    const _ = require('lodash');
    const soap = require('strong-soap/src/soap');
    const nc = require('../util/common');
    const matrix = require('../util/matrixHelper');

    let soapClient = null;

    let out = {
        ncStatusCode: null,
        payload: {}
    };

    let parentIDs = [];
    let cache = false;

    if (!callback) {
        throw new Error("A callback function was not provided");
    } else if (typeof callback !== 'function') {
        throw new TypeError("callback is not a function")
    }

    validateFunction().then(() => {
      if (payload.doc.pagingContext) {
        // Check for a pagingContext object
        // Contains the parent/child matrix IDs from the initial search

        createSoapClient()
          .then(createGetListRequest)
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
      } else {
        // Initial search for parents/child by IDs
        createSoapClient()
            .then(async () => {
              // Search Matrix Parent Products
              let searchPayload = createRequest("matrix");
              return await matrix.getMatrixProducts(searchPayload, soapClient, channelProfile, "matrix");
            })
            .then(async (result) => {
              // Combine Parent IDs - The lodash method 'union' joins and removes duplicates
              parentIDs = _.union(result, parentIDs);

              // Search Matrix Child Products
              let searchPayload = createRequest("matrixChild");
              return await matrix.getMatrixProducts(searchPayload, soapClient, channelProfile,"matrixChild");
            })
            .then(async (result) => {
              let parentObjects = [];

              // Combine Parent IDs - The lodash method 'union' joins and removes duplicates
              parentIDs = _.union(result, parentIDs);

              // Create initial objects for each virtual matrix parent
              parentIDs.forEach(function (parentID) {
                parentObjects.push({ "parent": parentID, "children": [] });
              });

              if (parentObjects.length > 0) {
                // Process products if we have parent IDs
                let searchPayload = createRequest("full", parentIDs);
                await matrix.getMatrixProducts(searchPayload, soapClient, channelProfile, "full", parentObjects)
                  .then(createGetListRequest)
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
              } else {
                // If no products were returned from the searches, build the response with a 204 ncStatusCode
                return buildResponse()
                  .catch(handleError)
                  .then(() => callback(out))
                  .catch(error => {
                      logError(`The callback function threw an exception: ${error}`);
                      setTimeout(() => {
                          throw error;
                      });
                  });
              }
            })
            .catch((err) => {
              handleError(err)
                .then(() => callback(out))
                .catch(error => {
                    logError(`The callback function threw an exception: ${error}`);
                    setTimeout(() => {
                        throw error;
                    });
              });
            })
      }
    })
    .catch((err) => {
      handleError(err)
        .then(() => callback(out))
        .catch(error => {
            logError(`The callback function threw an exception: ${error}`);
            setTimeout(() => {
                throw error;
            });
      });
    })

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
        else if (!channelProfile.productBusinessReferences)
            invalidMsg = "channelProfile.productBusinessReferences was not provided";
        else if (!nc.isArray(channelProfile.productBusinessReferences))
            invalidMsg = "channelProfile.productBusinessReferences is not an array";
        else if (!nc.isNonEmptyArray(channelProfile.productBusinessReferences))
            invalidMsg = "channelProfile.productBusinessReferences is empty";
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

    function createRequest(type = "matrix", parentIDs = null) {
        logInfo(`Building NetSuite Request. Type: ${type}`);

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

        // Flow Context Criteria Filters
        if (flowContext && flowContext.filterField && flowContext.filterCriteria) {
          let fieldName = flowContext.filterField;

          searchPayload["searchRecord"]["basic"][fieldName] = {
            "searchValue": flowContext.filterCriteria
          }

          if (flowContext.filterCompare) {
            searchPayload["searchRecord"]["basic"][fieldName]["$attributes"] = {
              "operator": flowContext.filterCompare
            }
          }
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

        } else if (payload.doc.remoteIDs && type !== "full") {

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

        // If current search is for matrix parent products
        if (type === "matrix") {
          searchPayload["searchRecord"]["basic"]["matrix"] = {
            "searchValue": "true"
          }
        }

        // If current search is for matrix child products
        if (type === "matrixChild") {
          searchPayload["searchRecord"]["basic"]["matrixChild"] = {
            "searchValue": "true"
          }
        }

        // If current search is to get the full matrix product
        if (type === "full" && parentIDs != null) {

          let values = [];

          parentIDs.forEach(function (parentID) {
            values.push({ "$attributes": { "internalId": parentID } });
          });

          searchPayload["searchRecord"]["parentJoin"] = {
            "internalId": {
              "$attributes": {
                "operator": "anyOf"
              },
              "$value": {
                "searchValue": values
              }
            }
          }
        }

        return searchPayload;
    }

    function createGetListRequest(parentObjects) {
      if (!payload.doc.pagingContext) {
        payload.doc.pagingContext = {
          parentObjects: parentObjects
        }
      }

      let parentObject = payload.doc.pagingContext.parentObjects[0];
      let getListPayload = {
        "record": []
      };
      let matrixProduct = {
        parentObject: parentObject
      }

      // Push parent and child products into the 'getList' operation
      getListPayload.record.push({
           "$attributes":{
              "$xsiType":{
                 "xmlns": channelProfile.channelSettingsValues.namespaces.platformCore,
                 "type": "RecordRef"
              },
            "internalId": parentObject.parent,
            "type": "inventoryItem"
         }
       });

       parentObject.children.forEach(function (childId) {
         getListPayload.record.push({
            "$attributes":{
               "$xsiType":{
                  "xmlns": channelProfile.channelSettingsValues.namespaces.platformCore,
                  "type": "RecordRef"
               },
             "internalId": childId,
             "type": "inventoryItem"
            }
          });
       });

       matrixProduct.getListPayload = getListPayload;

       return matrixProduct;
    }

    function callNetsuite(matrixProduct) {
      return new Promise((resolve, reject) => {
        logInfo("Calling NetSuite...");
        let operation = "getList"

        soapClient.clearSoapHeaders();
        let headers = nc.generateHeaders(channelProfile);
        soapClient.addSoapHeader(headers);

        soapClient[operation](matrixProduct.getListPayload, function(err, result) {
          if (!err) {
            delete matrixProduct.getListPayload;
            matrixProduct.result = result;
            resolve(matrixProduct);
          } else {
            reject(err);
          }
        });
      });
    }

    async function buildResponse(matrixProduct) {
      logInfo("Processing Response...");
      if (typeof matrixProduct !== 'undefined' && matrixProduct) {
        if (nc.isObject(matrixProduct.result)) {
          if (matrixProduct.result.readResponseList && matrixProduct.result.readResponseList.readResponse) {
            if (matrixProduct.result.readResponseList.status.$attributes.isSuccess === "true") {
              let docs = [];

              if (matrixProduct.result.readResponseList.readResponse.length > 0) {
                let childRecords = [];
                let product = { "record": {} };
                for (let i = 0; i < matrixProduct.result.readResponseList.readResponse.length; i++) {
                  if (matrixProduct.result.readResponseList.readResponse[i].record.$attributes.internalId == matrixProduct.parentObject.parent) {
                    product = {
                      record: matrixProduct.result.readResponseList.readResponse[i].record
                    };
                  } else {
                    childRecords.push( { "record" : matrixProduct.result.readResponseList.readResponse[i].record });
                  }

                  if (i == matrixProduct.result.readResponseList.readResponse.length - 1) {
                    product.record.matrixChildren = childRecords;
                  }
                }

                docs.push({
                  doc: product,
                  productRemoteID: matrixProduct.result.readResponseList.readResponse[0].record.$attributes.internalId,
                  productBusinessReference: nc.extractBusinessReference(channelProfile.productBusinessReferences, matrixProduct.result.readResponseList.readResponse[0])
                });

                if (docs.length == 0) {
                  out.ncStatusCode = 204;
                } else {
                  out.payload = docs;
                  payload.doc.pagingContext.parentObjects.splice(0, 1);
                  if (payload.doc.pagingContext.parentObjects.length > 0) {
                    out.ncStatusCode = 206;
                  } else {
                    out.ncStatusCode = 200;
                  }
                }
              } else {
                out.ncStatusCode = 204;
                out.payload = matrixProduct.result;
              }
            } else {
              if (matrixProduct.result.searchResult.status.statusDetail) {
                out.ncStatusCode = 400;
                out.payload.error = matrixProduct.result.searchResult.status.statusDetail;
              } else {
                out.ncStatusCode = 400;
                out.payload.error = matrixProduct.result;
              }
            }
          } else {
            out.ncStatusCode = 500;
            out.payload.error = matrixProduct.result;
          }
        } else {
          out.ncStatusCode = 204;
        }
      } else {
        out.ncStatusCode = 204;
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

module.exports.GetProductMatrixFromQuery = GetProductMatrixFromQuery;
