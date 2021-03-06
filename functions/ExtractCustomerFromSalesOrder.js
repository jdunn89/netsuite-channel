'use strict'

let ExtractCustomerFromSalesOrder = function(ncUtil, channelProfile, flowContext, payload, callback) {
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
        .then(extractCustomer)
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
        else if (!channelProfile.salesOrderBusinessReferences)
            messages.push("channelProfile.salesOrderBusinessReferences was not provided");
        else if (!nc.isArray(channelProfile.salesOrderBusinessReferences))
            messages.push("channelProfile.salesOrderBusinessReferences is not an array");
        else if (!nc.isNonEmptyArray(channelProfile.salesOrderBusinessReferences))
            messages.push("channelProfile.salesOrderBusinessReferences is empty");
        else if (!payload)
            messages.push("payload was not provided");
        else if (!payload.doc)
            messages.push("payload.doc was not provided");
        else if (!payload.doc.records)
            messages.push("payload.doc.records was not provided");
        else if (!nc.isArray(payload.doc.records))
            messages.push("payload.doc.records is not an array");
        else if (!nc.isNonEmptyArray(payload.doc.records))
            messages.push("payload.doc.records is empty");

        if (messages.length > 0) {
            messages.forEach(msg => logError(msg));
            out.ncStatusCode = 400;
            throw new Error(`Invalid request [${messages.join(", ")}]`);
        }
        logInfo("Function is valid.");
    }

    async function extractCustomer() {
        logInfo("Extracting customer...");
        let data = null;

        payload.doc.records.forEach(function (record) {
          if (record.record.$attributes.$xsiType.type === "Customer") {
            data = record;
          }
        });

        if (!data) {
          logWarn("No customer found.");
          out.ncStatusCode = 204;
        } else {
          out.payload.doc = data;
          out.ncStatusCode = 200;
        }
    }

    async function handleError(error) {
        logError(error);
        out.payload.error = error;
        out.ncStatusCode = out.ncStatusCode || 500;
    }
}
module.exports.ExtractCustomerFromSalesOrder = ExtractCustomerFromSalesOrder;
