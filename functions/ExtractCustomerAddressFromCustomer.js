'use strict'

let ExtractCustomerAddressFromCustomer = function(ncUtil, channelProfile, flowContext, payload, callback) {
    const nc = require('../util/common');

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
        .then(extractCustomerAddress)
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
        else if (!channelProfile.channelAuthValues)
            messages.push("channelProfile.channelAuthValues was not provided");
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
        else if (!payload.doc.record)
            messages.push("payload.doc.record was not provided");

        if (messages.length > 0) {
            messages.forEach(msg => logError(msg));
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${messages.join(", ")}]`);
        }
        logInfo("Function is valid.");
    }

    async function extractCustomerAddress() {
        logInfo("Extracting addresses...");

        if (payload.doc.record.addressbookList) {
            out.payload.doc = payload.doc.record.addressbookList;
            out.ncStatusCode = 200;
        } else {
            logWarn("No customer addresses found.");
            out.ncStatusCode = 204;
        }
    }

    async function handleError(error) {
        logError(error);
        out.payload.error = error;
        out.ncStatusCode = out.ncStatusCode || 500;
    }
}
module.exports.ExtractCustomerAddressFromCustomer = ExtractCustomerAddressFromCustomer;
