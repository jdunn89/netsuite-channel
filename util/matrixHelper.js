'use strict';

const _ = require('lodash');
const nc = require('./common');

let state = {
  stage: "",
  client: {},
  profile: {},
  parentArray: []
}

function getMatrixProducts(searchPayload, soapClient, channelProfile, type, parentIDs) {
  return new Promise((resolve, reject) => {
    state = {
      stage: type,
      client: soapClient,
      profile: channelProfile,
      parentArray: parentIDs
    }
    callNetsuite(searchPayload)
      .then(processResponse)
      .then((result) => {
        resolve(result);
      })
      .catch((err) => {
        let error = err;
        if (nc.isObject(err)) {
          error = JSON.stringify(err);
        }
        logError(`An error occurred in the getMatrixProducts helper function. Stage: ${type}. Error: ${error}`);
        reject(err);
      })
  });
}

function callNetsuite(searchPayload) {
  return new Promise((resolve, reject) => {
    logInfo("Calling NetSuite...");
    let operation = "search"

    state.client.clearSoapHeaders();
    let headers = nc.generateHeaders(state.profile);
    state.client.addSoapHeader(headers);

    if (searchPayload.searchId) {
      operation = "searchMoreWithId"
    }
    state.client[operation](searchPayload, function(err, result) {
      if (!err) {
        resolve(result);
      } else {
        reject(err);
      }
    });
  });
}

function associateProduct(record) {
  return new Promise((resolve, reject) => {
    let key = state.parentArray.findIndex((x => x.parent === record.parent.$attributes.internalId));
    state.parentArray[key].children.push(record.$attributes.internalId);
  });
}

function processResponse(result) {
  return new Promise((resolve, reject) => {
    logInfo("Processing Response...");
    if (result.searchResult) {
      if (result.searchResult.status.$attributes.isSuccess === "true") {
        let parentIDs = [];

        if (result.searchResult.recordList) {
          if (nc.isObject(result.searchResult.recordList.record)) {
            if (state.stage === "matrix") {
              parentIDs.push(result.searchResult.recordList.record.$attributes.internalId);
            } else if (state.stage === "matrixChild") {
              parentIDs.push(result.searchResult.recordList.record.parent.$attributes.internalId);
            } else {
              associateProduct(result.searchResult.recordList.record);
            }
          } else {
            if (state.stage === "matrix") {
              for (let i = 0; i < result.searchResult.recordList.record.length; i++) {
                parentIDs.push(result.searchResult.recordList.record[i].$attributes.internalId);
              }
            } else if (state.stage === "matrixChild") {
              for (let i = 0; i < result.searchResult.recordList.record.length; i++) {
                parentIDs.push(result.searchResult.recordList.record[i].parent.$attributes.internalId);
              }
            } else {
              for (let i = 0; i < result.searchResult.recordList.record.length; i++) {
                associateProduct(result.searchResult.recordList.record[i]);
              }
            }
          }

          if (result.searchResult.pageIndex < result.searchResult.totalPages) {
            let searchPayload = {
              "searchId": result.searchResult.searchId,
              "pageIndex": result.searchResult.pageIndex + 1
            }

            callNetsuite(searchPayload)
              .then(processResponse)
              .then((result) => {
                if (state.stage === "matrix" || state.stage === "matrixChild") {
                  let mergedIds = _.union(result, parentIDs);
                  resolve(mergedIds);
                } else {
                  resolve(state.parentArray);
                }
              })
              .catch((err) => {
                reject(`An error occurred processing the results of products. Stage: ${state.stage}. Error: ${err}`)
              });
          } else {
            if (state.stage === "matrix" || state.stage === "matrixChild") {
              resolve(parentIDs);
            } else {
              resolve(state.parentArray);
            }
          }
        } else {
          if (state.stage === "matrix" || state.stage === "matrixChild") {
            resolve(parentIDs);
          } else {
            resolve(state.parentArray);
          }
        }
      } else {
        if (result.searchResult.status.statusDetail) {
          reject(result.searchResult.status.statusDetail);
        } else {
          reject(result);
        }
      }
    } else {
      reject(result);
    }
  });
}

function logInfo(msg) {
    nc.log(msg, "info");
}

function logWarn(msg) {
    nc.log(msg, "warn");
}

function logError(msg) {
    nc.log(msg, "error");
}

module.exports = { getMatrixProducts };
