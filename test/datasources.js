db.register({
    name: 'my',
    isdefault: true,
    pluginName: 'window.sqlitePlugin',
    pluginConfig: {name: 'my.db.cipher', key: 'mypassword', location: 'default'},
    queriespath: 'queries/'
});