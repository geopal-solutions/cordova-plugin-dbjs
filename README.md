# cordova-plugin-dbjs
A cordova plugin to facilitate database interaction

This cordova plugin has been developed for Geopal's use in the GeoPal Mobile Platform App project. It's purpose is to build a layer on top of a chosen sqllite/sqlcipher plugin that allows to execute queries in a simple way while at the same time enforcing a neat separation between queries code and application code.

## v1.0.0-geopal
This is the version originally open-sourced by Geopal. To install it, you need a specific sqlcipher plugin, available at this URL:
[https://www.npmjs.com/package/cordova-sqlcipher-adapter]

Setup instructions:
```
cordova plugin add cordova-sqlcipher-adapter
cordova plugin add https://github.com/geopal-solutions/cordova-plugin-dbjs.git#v1.0.0-geopal
```
