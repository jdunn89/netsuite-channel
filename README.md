# NetSuite Channel

## v0.0.6

### Channel Settings
- Removed the `Application ID` and `Application Name` authentication parameters as they are not needed with token based authentication.
- Updated the parameters for the `GET PRODUCT` channel action with conditional requirements. The fields used for Virtual Matrix Products are not required unless the option to retrieve them is selected in the UI.
- Updating the 'do' flags to default to pulling simple products.

### Functions
- Fixed a bug with matrix products and virtual matrix products returning an error if no products were found with the initial searches.
- Fixed the pagingContext not being set correctly on the payload when performing a `GET` action on products.
- Updated the product functions to support filtering by custom fields.
- Updated the documents returned from the product functions as individual `record` objects instead of within an array.

### Schema
- Updating the product schemas to validate the `record` objects individually instead of within an array.
