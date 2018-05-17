'use strict';

const jsonata = require('jsonata');
const hmacsha1 = require('hmacsha1');

function log(msg, level = "info") {
    let prefix = `${new Date().toISOString()} [${level}]`;
    console.log(`${prefix} | ${msg}`);
};

function generateHeaders(channelProfile) {
  let timestamp = Math.floor(Date.now() / 1000);
  let nonce = computeNonce(10);

  // Prepare strings for generating the signature
  let base = channelProfile.channelAuthValues.account + "&" +
             channelProfile.channelAuthValues.consumerKey + "&" +
             channelProfile.channelAuthValues.tokenID + "&" +
             nonce + "&" +
             timestamp;

  let key =  channelProfile.channelAuthValues.consumerSecret + "&" + channelProfile.channelAuthValues.tokenSecret;

  // Generate Signature
  let signature = hmacsha1(key, base);

  let headers = {
    "searchPreferences": {
      "bodyFieldsOnly": false,
      "pageSize": 10
    },
    "tokenPassport": {
      "account": channelProfile.channelAuthValues.account,
      "consumerKey": channelProfile.channelAuthValues.consumerKey,
      "token": channelProfile.channelAuthValues.tokenID,
      "nonce": nonce,
      "timestamp": timestamp,
      "signature": {
        "$attributes": {
          "algorithm": "HMAC-SHA1"
        },
        "$value": signature
      }
    }
  };

  return headers;
}

function computeNonce(length) {
  let text = "";
  let possible = "0123456789";
  for(let i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function extractBusinessReference(businessReferences, doc) {
  const _get = require("lodash.get");

  if (!businessReferences || !Array.isArray(businessReferences)) {
    throw new Error('Error: businessReferences must be an Array');
  } else if (!doc || typeof doc !== 'object') {
    throw new Error('Error: doc must be an object');
  }

  let values = [];

  // Get the businessReference
  businessReferences.forEach(function(businessReference) {
      values.push(_get(doc, businessReference));
  });

  return values.join(".");
};

function isFunction(func) {
    return typeof func === "function";
}

function isString(str) {
    return typeof str === "string";
}

function isObject(obj) {
    return typeof obj === "object" && obj != null && !isArray(obj) && !isFunction(obj);
}

function isNonEmptyObject(obj) {
    return isObject(obj) && Object.keys(obj).length > 0;
}

function isArray(arr) {
    return Array.isArray(arr);
}

function isNonEmptyArray(arr) {
    return isArray(arr) && arr.length > 0;
}

function isNumber(num) {
    return typeof num === "number" && !isNaN(num);
}

function isInteger(int) {
    return isNumber(int) && int % 1 === 0;
}

module.exports = { log, generateHeaders, extractBusinessReference, isFunction, isString, isObject, isNonEmptyObject, isArray, isNonEmptyArray, isNumber, isInteger };
