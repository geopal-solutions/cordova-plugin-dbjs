/**
 * Builds on top of dbjs to add support for database structure upgrades.
 */

var db = cordova.plugins.db;
var Query = db.Query;
var DataSource = db.DataSource;
var QueryRunner = db.QueryRunner;
var QueryParser = db.QueryParser;

var FileNotFoundError = db.Exceptions.FileNotFoundError;
var TimeoutError = db.Exceptions.TimeoutError;

var log = console.debug || console.log;

log = log.bind(console);


var anycol = function(row) {
	for(var key in row) {
		return row[key];
	}
	return undefined;
}

var shallowClone = function(obj) {
	var result = {};
	for(var key in obj) {
		result[key] = obj[key];
	}

	return result;
}

var lpad = function(val, len, padstr) {
	var result = val;
	if(typeof(result) === 'undefined' || result == "null") {
		result = "";
	}
	result = result.toString();
	while(result.length < len) {
		result = padstr + result;
	}
	return result;
};

var succeed = function(value) {
	return new Promise(function(successCallback, failureCallback) { successCallback(value); });
};


function DataSourceUpgrader(config) {
	// config has the datasource name and the versioning table
	this.config = config;
	if(!config.migrationtable) {
		config.migrationtable = "db_migration_info";
	}
	if(!config.datasource) {
		config.datasource = config.name;
	}
}

DataSourceUpgrader.prototype._getMigrationTable = function(config) {
	return new Promise(function(successCallback, failureCallback) {
		db(config.datasource).executeUnsafe("select count(*) as cnt from sqlite_master WHERE type='table' and name = :migrationtable", config).then(function(rs) {
			var row = rs.rows.item(0);
			var val = anycol(row);
			if(val > 0) {
				console.log("Migration table found.");
				successCallback(config);
			}
			else {
				console.log("Migration table not found.");
				failureCallback();
			}
		}, function(err) {
			console.error("Could not complete query to obtain migration table.");
			failureCallback(err);
		});
	});
};

DataSourceUpgrader.prototype._getDatabaseVersion = function(config) {
	return new Promise(function(successCallback, failureCallback) {
		db(config.datasource).executeUnsafe("select max(version) from {migrationtable} where name = :name", config).then(function(rs) {
			var row = rs.rows.item(0);
			var val = anycol(row);
			if(typeof(val) != 'undefined') {
				successCallback(val);
			}
			else {
				failureCallback();
			}
		}, function(err) {
			console.error("Could not execute query to get max version of entry in migration table.");
			failureCallback(err);
		});
	});
};


DataSourceUpgrader.prototype.upgrade = function() {
	var dsname = this.config.datasource;
	/*
	In order to upgrade you need to:
	1. check whether the versions table exists on the database
	2. read the max from the versions table
	4. progressively run scripts starting from the one with a number that is greater than the current version by 1 unit.
	5. you stop when there's no more script to run
	*/
	var datasource = db(dsname);
	var dsconfig = shallowClone(datasource.config);
	dsconfig.queriespath = dsconfig.queriespath + "/db_migration/" + this.config.name + "/";
	var migration_datasource = new DataSource(dsconfig);
	var stop = false;

	var me = this;

	var executeScripts = function(scripts) {
		// we want to execute the scripts in the provided order
		var migration = this;
		var promise = Promise.resolve();
		for(var i = 0; i < scripts.length; i++) {
			promise = promise.then(function() {
				var script = scripts.splice(0, 1);
				script = script[0];
				log("Executing sql statement in: " + script);
				return migration.datasource.execute(migration.dir + script);
			});
		}
		return promise;
	};

	var insert = function(ver) {
		return function() {
			log("Adding new migration information to table " + me.config.migrationtable);
			return migration_datasource.executeUnsafe("insert into {migrationtable} ( name , version ) values ( :name , :version )", { migrationtable: me.config.migrationtable, name: me.config.name, version: ver });
		};
	};

	var execute = function(ver) {
		return function() {
			var migration_plain_name = "migration_" + lpad(ver, 8, "0");
			var migration_name = migration_plain_name + ".js";
			log("Attempting execution of migration script " + migration_name);
			var runner = new QueryRunner(dsconfig, migration_name, {}, {});
			var context = {
				datasource: datasource,
				migration: {
					datasource: migration_datasource,
					version: ver,
					upgrader: me,
					dir: migration_plain_name + "/"
				}
			};
			context.migration.executeScripts = executeScripts.bind(context.migration);
			runner.setContext(context);
			return runner.execute();
		};
	};

	var migrate = function(ver) {
		return function() {
			return succeed().then(execute(ver)).then(insert(ver)).then(migrate(ver + 1));
		};
	};

	var start_migrate = function(ver) {
		return migrate(ver + 1)();
	}

	return new Promise((function(successCallback, failureCallback) {
		this._getMigrationTable(this.config).then(this._getDatabaseVersion).then(start_migrate).then(successCallback, function(err) {
			if(err instanceof FileNotFoundError) {
				successCallback(datasource);
			}
			else {
				failureCallback();
			}
		})
	}).bind(this));
};

/**
 * Makes the datasource upgradable
 */
DataSourceUpgrader.prototype.makeUpgradable = function() {
	/*
	1. check whether the versions table exists on the database
	2. if it does, nothing to do
	3. if it doesn't, it creates one and adds one row with version 0
	*/
	var me = this;
	var config = this.config;
	var name = config.datasource;
	var datasource = db(name);

	return new Promise(function(successCallback, failureCallback) {
		me._getMigrationTable(me.config).then(successCallback, function() {
			// need to create migration table
			datasource.executeUnsafe("create table {migrationtable} (name text, version integer)", config).then(function() {
				datasource.executeUnsafe("insert into {migrationtable} ( name , version ) values ( :name , :version )", { migrationtable: config.migrationtable, name: config.name, version: 0 }).then(successCallback, failureCallback);
			}, function(err) {
				console.error("Could not create the migration table.");
				failureCallback(err);
			});
		});
	});
};


var upgradableDatasources = {};


function DatabaseVersionManager(name) {
	var uds = upgradableDatasources[name];
	if(typeof(uds) == 'undefined') {
		uds = new DataSourceUpgrader({ name: name });
	}
	return uds;
}

DatabaseVersionManager.register = function(config) {
    upgradableDatasources[config.name] = new DataSourceUpgrader(config);
};

/**
 * Upgrades the database and returns a Promise that the upgrade will be done.
 * @method upgrade
 * @memberof DataSource
 */
DataSource.prototype.upgrade = function() {
	var me = this;
	var upgrader = DatabaseVersionManager(this.config.name);
	return upgrader.makeUpgradable().then(upgrader.upgrade.bind(upgrader)).then(function() { return me; });
};


module.exports = DatabaseVersionManager;

