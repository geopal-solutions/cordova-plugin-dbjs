function Deferred() {
    var callbacks = {
        resolve: function() {},
        fail: function() {}
    };

    this.resolver = (function(success, failure) {
        callbacks.resolve = success;
        callbacks.fail = failure;
    }).bind(this);

    this.result = undefined;
    this.failresult = undefined;
    this.resolved = false;
    this.failed = false;

    this.resolve = (function(data) {
        this.result = data;
        this.resolved = true;
        callbacks.resolve(data);
    }).bind(this);

    this.fail = (function(data) {
        this.failresult = data;
        this.failed = true;
        callbacks.fail(data);
    }).bind(this);

    this.promise = new Promise(this.resolver);
}


var FileNotFoundError = function(message) {
    this.message = message;
}

var TimeoutError = function(message) {
    this.message = message;
};

FileNotFoundError.prototype = new Error;
TimeoutError.prototype = new Error;

var filesCache = {};
var functionsCache = {};

var getAbsoluteURL = function(relative) {
    var a = document.createElement('a');
    a.href = relative;
    return a.href;
}

var readFile = function(pathname, asynchronous, successCallback, failureCallback) {
    var deferred = filesCache[pathname];
    if(deferred) {
        if(asynchronous) {
            deferred.promise.then(successCallback);
            return;
        }
        else if(deferred.resolved) {
            return deferred.result;
        }
    }
    else {
        deferred = new Deferred();
        filesCache[pathname] = deferred;
    }

    var oReq = new XMLHttpRequest();
    oReq.open("GET",  pathname, asynchronous);
    oReq.timeout = 5000;
    oReq.onload = function() {
        if(oReq.status === 200 || oReq.status === 0) {
            oReq.onload = null;
            oReq.ontimeout = null;
            oReq.onerror = null;
            deferred.resolve(oReq.responseText);
            successCallback(oReq.responseText);
        }
        else {
            oReq.onload = null;
            oReq.ontimeout = null;
            oReq.onerror = null;
            failureCallback();
        }
    };
    oReq.ontimeout = function(req) {
        oReq.onload = null;
        oReq.ontimeout = null;
        oReq.onerror = null;
        failureCallback(new TimeoutError("Request timed out."));
    };
    oReq.onerror = function(req) {
        oReq.onload = null;
        oReq.ontimeout = null;
        oReq.onerror = null;
        failureCallback(new FileNotFoundError("File not found: " + pathname));
    };
    if(asynchronous) {
        if(window.resolveLocalFileSystemURL) {  // if we have the file plugin, we try to resolve the file beforehand to avoid unnecessary errors on the console
            window.resolveLocalFileSystemURL(getAbsoluteURL(pathname), function() {
                oReq.send(null);
            }, function(err) {
                oReq.onload = null;
                oReq.ontimeout = null;
                oReq.onerror = null;
                failureCallback(new FileNotFoundError("File not found: " + pathname));
            });
        }
        else {  // otherwise, business as usual and we log what's on the console
            oReq.send(null);
        }
        return;
    }
    else {
        oReq.send(null);
    }

    if(oReq.status === 200 || oReq.status === 0) {
        deferred.resolve(oReq.responseText);
        return oReq.responseText;
    }
    else {
        throw new FileNotFoundError("File not found: " + pathname);
    }
};

var readFileAsync = function(pathname) {
    return new Promise(function(successCallback, failureCallback) {
        readFile(pathname, true, successCallback, failureCallback);
    });
};

var thenableSuccess = function(result) {
    return function() {
        return new Promise(function(successCallback, failureCallback) {
            successCallback(result);
        });
    }
};

var NoOp = function(result) {
    this.result = result;
};

var tokenchar = /[a-zA-Z0-9_%]/;

/**
 * Given a query text and an array of parameter names, finds the first parameter name that appears in the query text, starting from a given index
 */
var indexOfAnyParam = function(str, items, startIndex) {
    var lowestIndex = str.length + 1;
    var matchingItem = null;
    var matchingItemIndex = -1;
    for(var i = 0; i < items.length; i++) {
        var item = items[i];
        var idx = str.indexOf(item, startIndex);
        if(idx >= 0 && idx < lowestIndex) {
            var ch = str.substring(idx + item.length, idx + item.length + 1);
            if(!tokenchar.test(ch)) {
                lowestIndex = idx;
                matchingItem = item;
                matchingItemIndex = i;
            }
        }
    }

    var result = {
        index: -1,
        item: null,
        itemIndex: -1
    };

    if(matchingItem != null) {
        result.index     = lowestIndex;
        result.item      = matchingItem;
        result.itemIndex = matchingItemIndex;
    }

    return result;
};

var scanTokenEnd = function(str, start) {
    for(var i = start; i < str.length; i++) {
        var ch = str[i];
        if(!tokenchar.test(ch)) {
            return i;
        }
    }
    return str.length;
};

var clone = function(obj) {
    if(!obj) {
        return obj;
    }
    var result = {};
    for(var key in obj) {
        result[key] = obj[key];
    }
    return result;
}

var cleanargs = function(obj) {
    if(!obj) {
        return obj;
    }
    var result = {};
    for(var key in obj) {
        var val = obj[key];
        if(!(val instanceof Array)) {
            result[key] = val;
        }
        else if(val.length > 0) {
            result[key] = val;
        }
    }
    return result;
};


/**
 * Parses a given query, applying various transformations in order to get the final query
 */
function QueryParser(rawquerytext, scripting, querypath) {
    this._rawQueryText = rawquerytext;
    this._scripting = scripting;
    this._querypath = querypath;
};

/**
 * Toggles are used to comment/uncomment pieces of a query.
 * They work under the assumption that they are the start of a line of a query. Whenever a toggle is matched, its comment token is removed from the resulting query,
 *  thus enabling the condition. Once all toggles are processed, the lines still commented are removed from the resulting query.
 * They can be used to add/remove conditions to the where clause or to the sort clause, for example.
 * As they could potentially be used as a vehicle for sql injection, there are limitations on the allowed characters in a toggle.
 *
 * Example:
 * == querytext ==
 *   select
 *       column_a,
 *       column_b
 *   from
 *       mytable
 *   where 1=1
 *       -- col_a -- and column_a = :col_a
 *       -- col_b -- and column_b {col_b_op|=} :col_b  -- saying {col_b_op|=} means "use the value of col_b_op, but when empty just write = instead"
 *       -- col_c -- and column_c in (:col_c) -- this will be expanded. col_c is expected to be an array
 *   order by
 *       -- sort:col_b asc -- column_b asc,
 *       -- sort:col_b desc -- column_b desc,
 *       id desc  -- when you do an order-by, always end it with the primary key for repeatability purposes
 * == args ==
 *   { col_a: "myvalue", sort: "col_b desc", col_c: ["one", "two", "three"] }
 * == output ==
 *   select
 *       column_a,
 *       column_b
 *   from
 *       mytable
 *   where 1=1
 *       and column_a = :col_a
 *       and column_c in (:COL_C_0, :COL_C_1, :COL_C_2)
 *   order by
 *       column_b desc,
 *       id desc  -- when you do an order-by, always end it with the primary key for repeatability purposes
 * 
 * As the double dash (--) is the comment in SQL, the produced query will have the where condition uncommented as well as the second sort condition.
 * Also note the expansion of the array. While this is not done as part of this processing, an empty array would not deactivate the comment, thus leaving the condition disabled.
 */
QueryParser.prototype._processQueryTextForToggles = function(querytext, args) {
    if(querytext.indexOf("--") < 0) {   // no toggles in the query. Processing is pointless.
        return querytext;
    }

    var args = cleanargs(args);
    var toggles = [];
    var invalid = /[^0-9a-zA-Z_% ]/g;
    for(var key in args) {
        key = key.toString().replace(invalid, "");
        toggles.push("-- " + key + " -- ");
        toggles.push("-- " + key + " --\t");
        var val = args[key];
        if(val != null) {
            val = args[key].toString().replace(invalid, "");
            toggles.push("-- " + key + ":" + val + " -- ");
            toggles.push("-- " + key + ":" + val + " --\t");
        }
        else {
            toggles.push("-- " + key + " is null -- ");
            toggles.push("-- " + key + " is null --\t");
        }
    }

    var result = querytext;

    for(var i = 0; i < toggles.length; i++) {
        var toggle = toggles[i];
        var idx = -1;
        while((idx = result.indexOf(toggle)) >= 0) {
            result = result.substring(0, idx) + result.substring(idx + toggle.length);
        }
    }

    var lines = result.split("\n");
    var outlines = [];
    for(var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if(!line.trim().startsWith("--")) {
            outlines.push(line);
        }
    }

    result = outlines.join("\n");

    return result;
};

/**
 * Processes the supplied query text, replacing tokens with values and applying the toggles.
 */
QueryParser.prototype._processQueryText = function(querytext, args, context, querypath) {
    var queryfn = null;
    if(querypath) {
        queryfn = functionsCache[querypath];
    }
    if(queryfn) {
        return queryfn(args, context);
    }
    else if(querytext.startsWith("/* eval */") || this._scripting === true) {
        try {
            var fn = eval("(function(args, context) {\n" + querytext + "\n })");
            if(querypath) {
                functionsCache[querypath] = fn;
            }
            return fn(args, context);
        }
        catch(err) {
            console.error("Error while parsing a query script.");
            console.error(err);
            throw err;
        }
    }
    else {
        var result = querytext;
        var index = -1;
        var idx = -1;
        var tokenargs = clone(args) || {};
        while((idx = result.indexOf("{", index + 1)) > index) {
            index = idx;
            var end = scanTokenEnd(result, index + 1);
            var name = result.substring(idx + 1, end);
            var brace = result.indexOf("}", end);
            var pipe = result[end] == '|';
            var def = undefined;
            if(pipe) {
                def = result.substring(end + 1, brace);
                result = result.substring(0, end) + result.substring(brace, result.length);
            }
            if(!tokenargs[name] && !(typeof(def) == 'undefined')) {
                tokenargs[name] = def;
            }
        }

        if(tokenargs) {
            for(var key in tokenargs) {
                while(result.indexOf("{" + key + "}") >= 0) {   // this is a replaceAll without regex, as JavaScript doesn't have one apparently
                    result = result.replace("{" + key + "}", tokenargs[key]);
                }
            }
        }
        result = this._processQueryTextForToggles(result, args);
        return result;
    }
};

QueryParser.prototype._expandArrayParameters = function(querytext, args) {
    var u_querytext = querytext.toUpperCase();
    var oldargs = [];
    var replacements = {};
    var newargs = {};
    for(var key in args) {
        var val = args[key];
        var argbase = ":" + key.toUpperCase();
        if(val instanceof Array) {
            oldargs.push(argbase);
            var replacement = [];
            for(var i = 0; i < val.length; i++) {
                var param = key.toUpperCase() + "_" + i;
                newargs[param] = val[i];
                replacement.push(":" + param);
            }
            replacements[argbase] = replacement.join(", ");
        }
        else {
            newargs[key] = val;
        }
    }
    var match = {
        index: 0,
        item: null,
        itemIndex: -1
    };
    while((match = indexOfAnyParam(u_querytext, oldargs, match.index)).index > -1) {
        var replacement = replacements[match.item];
        querytext = querytext.substring(0, match.index) + replacement + querytext.substring(match.index + match.item.length);
        u_querytext = u_querytext.substring(0, match.index) + replacement + u_querytext.substring(match.index + match.item.length);
    }

    return {
        querytext: querytext,
        args: newargs
    };
};

QueryParser.prototype._processQueryTextForParameters = function(querytext, args) {
    var args = cleanargs(args);
    var expanded = this._expandArrayParameters(querytext, args);
    querytext = expanded.querytext;
    args = expanded.args;
    var u_querytext = querytext.toUpperCase();
    var args_array = [];
    var vals_array = [];
    for(var key in args) {
        var val = args[key];
        args_array.push(":" + key.toUpperCase());
        vals_array.push(val);
    }
    var match = {
        index: 0,
        item: null,
        itemIndex: -1
    };
    var values = [];
    while((match = indexOfAnyParam(u_querytext, args_array, match.index)).index > -1) {
        var val = vals_array[match.itemIndex];
        values.push(val);
        u_querytext = u_querytext.substring(0, match.index) + "?" + u_querytext.substring(match.index + match.item.length);
        querytext   = querytext.substring(0, match.index)   + "?" + querytext.substring(match.index + match.item.length);
    }

    return {
        querytext: querytext,
        parameters: values
    };
};

/**
 * Parses a query to apply the specified template arguments and query arguments.
 * Returns an object containing the resulting 'querytext' and 'parameters'.
 */
QueryParser.prototype.parse = function(templateargs, queryargs, context) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        var query = me._processQueryText(me._rawQueryText, templateargs || {}, context, me._querypath);
        if(!(query instanceof Promise)) {
            query = Promise.resolve(query);
        }
        query.then(function(result) {
            if(typeof(result) === 'string') {
                successCallback(me._processQueryTextForParameters(result, queryargs));
            }
            else if(result.querytext && result.parameters) {
                successCallback(result);
            }
            else {
                successCallback(new NoOp(result));
            }
        }, failureCallback);
    });
};


var openedDatabases = {};



function QueryRunner(config, queryname, templateargs, args) {
    this.config = config;
    this.databasename = config.name;
    this.pluginName = config.pluginName || 'window.sqlitePlugin';
    this.pluginConfig = config.pluginConfig;
    this.queryname = queryname;
    this.querypath = config.queriespath + queryname;
    this.templateargs = templateargs;
    this.args = args;
    this._context = null;
}

QueryRunner.prototype.setContext = function(context) {
    this._context = context;
    return this;
};
QueryRunner.prototype.getContext = function() {
    return this._context;
};

QueryRunner.prototype._openDatabaseAsync = function() {
    var me = this;
    var plugin = eval(me.pluginName);

    var opendb = openedDatabases[me.databasename];
    return new Promise(function(successCallback, failureCallback) {
        var opendb = openedDatabases[me.databasename];
        if(opendb) {
            me._database = opendb;
            successCallback();
        }
        else {
            plugin.openDatabase(me.pluginConfig, function(database) {
                openedDatabases[me.databasename] = database;
                me._database = database;
                successCallback();
            }, failureCallback);
        }
    });
};
QueryRunner.prototype._promiseProcessQuery = function(scripting, querypath) {
    var me = this;
    return (function(rawQueryText) {
        return new Promise(function(successCallback, failureCallback) {
            var parser = new QueryParser(rawQueryText, scripting, querypath);
            parser.parse(me.templateargs, me.args, me.getContext()).then(successCallback, failureCallback);
        });
    }).bind(this);
};
QueryRunner.prototype._readQueryAsync = function() {
    return readFileAsync(this.querypath);
};
QueryRunner.prototype._executeSql = function(queryinfo) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        if(queryinfo instanceof NoOp) {
            me._queryResult = queryinfo.result;
            successCallback(me._queryResult);
        }
        else {
            me._database.executeSql(queryinfo.querytext, queryinfo.parameters, function(rs) {
                me._queryResult = rs;
                successCallback(rs);
            }, function(err) {
                console.error("Error executing a query through _executeSql. Details follow.");
                console.error("Query:");
                console.error(queryinfo.querytext);
                console.error("Parameters:");
                console.error(queryinfo.parameters);
                console.error("Error:");
                console.error(err);
                failureCallback(err);
            });
        }
    });
};
QueryRunner.prototype.execute = function() {
    return this._openDatabaseAsync().then(this._readQueryAsync.bind(this)).then(this._promiseProcessQuery(this.queryname.endsWith(".js"), this.querypath)).then(this._executeSql.bind(this));
};
QueryRunner.prototype.executeUnsafe = function(sql) {
    return this._openDatabaseAsync().then(thenableSuccess(sql)).then(this._promiseProcessQuery(false, null)).then(this._executeSql.bind(this));
};
QueryRunner.prototype.executeSimple = function(parameters) {
    return this._openDatabaseAsync().then(this._readQueryAsync.bind(this)).then(function(sql) {
        return { querytext: sql, parameters: parameters };
    }).then(this._executeSql.bind(this));
};
QueryRunner.prototype.executeSimpleUnsafe = function(sql, parameters) {
    return this._openDatabaseAsync().then(thenableSuccess(sql)).then(function(sql) {
        return { querytext: sql, parameters: parameters };
    }).then(this._executeSql.bind(this));
};

//TODO: implement use of sqlBatch so that multiple queries can be executed together.

/**
 * Represents a datasource, allowing to access information on a database.
 * @class DataSource
 * @param {Object} config The configuration of this datasource
 */
function DataSource(config) {
    this.config = config;
}

/**
 * Represents a Query. A Query allows you to access the underlying database data. The DataSource object will replicate most of the methods in the query object
 * @class Query
 * @param {DataSource} datasource The datasource to use
 * @param {String} name The relative path and name of the file containing the query statement. The file should either be a _.sql_ file or a _.js_ file. When it's a _.js_ file, the statement will be processed as JavaScript using eval.
 * @param {Object} templateargs Can be anything, but when not empty in most cases will be a dictionary of key-value pairs that will be used to modify the statement before processing
 */
function Query(datasource, name, templateargs) {
    this.datasource = datasource;
    this.name = name;
    this.templateargs = templateargs;
    this._context = {
        datasource: datasource,
        query: this
    };
}

// we now define the interfaces
// DataSource.prototype.transaction = function() {};
// DataSource.prototype.commit = function() {};
// DataSource.prototype.rollback = function() {};
/**
 * Returns a new Query object, configured to run against the current DataSource
 * @method query
 * @instance
 * @memberof DataSource
 * @param {String} name The relative path and name of the file containing the query statement
 * @param {Object} templateargs Can be anything, but when not empty in most cases will be a dictionary of key-value pairs that will be used to modify the statement before processing
 */
DataSource.prototype.query = function(name, templateargs) {};
/**
 * See the Query object documentation
 * @method list
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.list = function(name, args) {};
/**
 * See the Query object documentation
 * @method execute
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.execute = function(name, args) {};
/**
 * See the Query object documentation
 * @method executeUnsafe
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.executeUnsafe = function(sql, args) {};
/**
 * See the Query object documentation
 * @method executeSimple
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.executeSimple = function(name, args) {};
/**
 * See the Query object documentation
 * @method executeSimpleUnsafe
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.executeSimpleUnsafe = function(sql, args) {};
/**
 * See the Query object documentation
 * @method iterate
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.iterate = function(name, args, callback) {};
/**
 * See the Query object documentation
 * @method scalar
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.scalar = function(name, args, defaultvalue) {};
/**
 * See the Query object documentation
 * @method unique
 * @instance
 * @memberof DataSource
 */
DataSource.prototype.unique = function(name, args, defaultvalue) {};
/**
 * See the Query object documentation
 * @method first
 * @instance
 * @memberof DataSource
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the row.
 */
DataSource.prototype.first = function(name, args, defaultvalue) {};

/**
 * Ideally meant to be called when the query file contains a SELECT statement, this method returns a Promise to return the rows property of the resultset.
 * @method list
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the rows property of the resultset. See WebSQL specifications to know how to access the items in this collection.
 * @example
 *  -- queries/get_people.sql file. You will need this file to run the example
 *  select * from people
 *  where 1 = 1 -- neat trick to allow optionally injecting conditions
 *  -- age_min -- and age >= :age_min
 *  -- age_max -- and age <= :age_max
 * @example
 * var mydb = db(); // see the db.register function documentation to know how to configure your datasources
 * mydb.query("get_people.sql", {}).list({ age_min: 20, age_max: 30 }).then(function(rows) {
 *     var index = 0;
 *     var row = null;
 *     var html = '';
 *     while((row = rows.item(index++)) != null) {
 *         html += row.first_name + " " + row.last_name + "<br>";
 *     }
 *     document.writeln(html);
 * });
 * 
 */
Query.prototype.list = function(args) {};
/**
 * Executes a query and returns the resulting resultset. This method is normally meant to be used with INSERT/UPDATE/DELETE statements, as well as CREATE and DROP ones.
 * @method execute
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the resultset. See WebSQL specifications to know how such object is structured.
 * @example
 *  -- queries/insert_person.sql file. You will need this file to run the example
 *  insert into people
 *  (
 *      first_name
 *      , last_name
 *      -- age -- , age
 *  )
 *  values
 *  (
 *      :first_name
 *      , :last_name
 *      -- age -- , :age
 *  )
 * @example
 * var mydb = db(); // gets the default database
 * mydb.query("insert_person.sql", {}).execute({ first_name: "Filippo", last_name: "Possenti", age: 35 }).then(function(rs) {
 *     console.log("Row inserted, with age.");
 * });
 * mydb.query("insert_person.sql", {}).execute({ first_name: "Sean", last_name: "O'Reilly" }).then(function(rs) {
 *     console.log("Row inserted, without age.");
 * });
 */
Query.prototype.execute = function(args) {};
/**
 * Executes the provided SQL statement and returns the resulting resultset. The word "unsafe" is meant to point out that whatever you pass to it will be run, meaning there's an high chance that your code will become subject to SQL-injection.
 * This method is meant to be used mainly during debug and should never be used from within your software, unless the user has the freedom to imput his own queries.
 * Also, note that there is no need to use this method even when the query has to be composed dynamically, as the library supports using js files as named queries.
 * 
 * @method executeUnsafe
 * @param {String} sql The sql statement to execute
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the resultset. See WebSQL specifications to know how such object is structured.
 */
Query.prototype.executeUnsafe = function(sql, args) {};
/**
 * Executes a query without passing it to the preprocessor. Useful if you know exactly the order of your parameters, can provide significantly better performance as it skips all the parsing.
 * @method executeSimple
 * @param {Array} args An array of positional parameters that will be used in the query
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the resultset. See WebSQL specifications to know how such object is structured.
 */
Query.prototype.executeSimple = function(args) {};
/**
 * Executes a query without passing it to the preprocessor. Useful if you know exactly the order of your parameters, can provide significantly better performance as it skips all the parsing.
 * @method executeSimpleUnsafe
 * @param {String} sql The sql statement to execute
 * @param {Array} args An array of positional parameters that will be used in the query
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the resultset. See WebSQL specifications to know how such object is structured.
 */
Query.prototype.executeSimpleUnsafe = function(sql, args) {};
/**
 * Meant to be used with SELECT statements, this method will iterate through all records, passing them to the provided callback function as the first parameter.
 * @method iterate
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @param {Function} callback A callback function. The first argument will be the row, the second will be the index of the row and the third one the resultset
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the resultset. See WebSQL specifications to know how such object is structured.
 */
Query.prototype.iterate = function(args, callback) {};
/**
 * Executes the query expecting it to return exactly one row. The value of the first column of that row will be extracted and returned to the user.
 * @method scalar
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @param {Object} defaultvalue When no row is returned by the query and this value is provided, it will be returned instead of having the Promise fail.
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the value of the first column.
 * @example
 *  -- queries/count_people.sql file. You will need this file to run the example
 *  select count(*) from people
 *  where 1 = 1 -- neat trick to allow optionally injecting conditions
 *  -- age_min -- and age >= :age_min
 *  -- age_max -- and age <= :age_max
 * @example
 * var mydb = db(); // see the db.register function documentation to know how to configure your datasources
 * mydb.query("count_people.sql", {}).scalar({ age_min: 20, age_max: 30 }).then(function(amount) {
 *     document.writeln("There are " + amount + " people with an age between 20 and 30.");
 * });
 */
Query.prototype.scalar = function(args, defaultvalue) {};
/**
 * Executes the query expecting it to return exactly one row. The row will then be returned to the user.
 * @method unique
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @param {Object} defaultvalue When no row is returned by the query and this value is provided, it will be returned instead of having the Promise fail.
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the row.
 */
Query.prototype.unique = function(args, defaultvalue) {};
/**
 * Executes the query expecting it to return at least one row. The first row will then be returned to the user.
 * @method first
 * @param {Object} args A collection of key-value pairs representing named parameters for the query.
 * @param {Object} defaultvalue When no row is returned by the query and this value is provided, it will be returned instead of having the Promise fail.
 * @instance
 * @memberof Query
 * @returns {Promise} A promise that, if fulfilled, will have as first parameter of the success function the row.
 */
Query.prototype.first = function(args, defaultvalue) {};




DataSource.prototype.query = function(name, templateargs) {
    return new Query(this, name, templateargs);
};
DataSource.prototype.execute = function(name, args) {
    return this.query(name, args).execute(args);
};
DataSource.prototype.executeUnsafe = function(sql, args) {
    return this.query("__unsafe__", args).executeUnsafe(sql, args);
};
DataSource.prototype.executeSimple = function(name, args) {
    return this.query(name, args).executeSimple(args);
};
DataSource.prototype.executeSimpleUnsafe = function(sql, args) {
    return this.query(name, args).executeSimpleUnsafe(sql, args);
};
DataSource.prototype.list = function(name, args) {
    return this.query(name, args).list(args);
};
DataSource.prototype.iterate = function(name, args, callback) {
    return this.query(name, args).iterate(args, callback);
};
DataSource.prototype.scalar = function(name, args, defaultvalue) {
    return this.query(name, args).scalar(args, defaultvalue);
};
DataSource.prototype.unique = function(name, args, defaultvalue) {
    return this.query(name, args).unique(args, defaultvalue);
};
DataSource.prototype.first = function(name, args, defaultvalue) {
    return this.query(name, args).first(args, defaultvalue);
};


Query.prototype.execute = function(args) {
    var runner = new QueryRunner(this.datasource.config, this.name, this.templateargs, args);
    runner.setContext({ datasource: this.datasource, query: this });
    return runner.execute();
};
Query.prototype.executeUnsafe = function(sql, args) {
    var runner = new QueryRunner(this.datasource.config, this.name, this.templateargs, args);
    runner.setContext({ datasource: this.datasource, query: this });
    return runner.executeUnsafe(sql, args);
};
Query.prototype.executeSimple = function(args) {
    var runner = new QueryRunner(this.datasource.config, this.name, this.templateargs, args);
    runner.setContext({ datasource: this.datasource, query: this });
    return runner.executeSimple(args);
};
Query.prototype.executeSimpleUnsafe = function(sql, args) {
    var runner = new QueryRunner(this.datasource.config, this.name, this.templateargs, args);
    runner.setContext({ datasource: this.datasource, query: this });
    return runner.executeSimpleUnsafe(sql, args);
};
Query.prototype.list = function(args) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        me.execute(args).then(function(rs) {
            successCallback(rs.rows);
        }, failureCallback);
    });
};
Query.prototype.iterate = function(args, callback) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        me.execute(args).then(function(rs) {
            var item = null;
            var index = 0;
            while((item = rs.rows.item(index)) != null) {
                callback(item, index, rs);
                index++;
            }
            successCallback(rs.rows);
        }, failureCallback);
    });
};
Query.prototype.scalar = function(args, defaultvalue) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        var d = defaultvalue;
        if(typeof(d) !== 'undefined') {
            d = { value: defaultvalue };
        }
        me.unique(args, d).then(function(result) {
            for(var key in result) {
                successCallback(result[key]);
                return;
            }
            failureCallback();
        }, failureCallback);
    });
};
Query.prototype.unique = function(args, defaultvalue) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        me.execute(args).then(function(rs) {
            var rows = rs.rows;
            if(rows.length > 1) {
                failureCallback(new Error("Too many rows. Expected 1, obtained many."));
                return;
            }
            if(rows.length == 0 && typeof(defaultvalue) === 'undefined') {
                failureCallback(new Error("Too few rows. Expected 1, obtained none."));
                return;
            }
            if(rows.length == 0) {
                successCallback(defaultvalue);
                return;
            }
            successCallback(rows.item(0));
        }, failureCallback);
    });
};
Query.prototype.first = function(args, defaultvalue) {
    var me = this;
    return new Promise(function(successCallback, failureCallback) {
        me.execute(args).then(function(rs) {
            var rows = rs.rows;
            if(rows.length == 0 && typeof(defaultvalue) === 'undefined') {
                failureCallback(new Error("Too few rows. Expected 1, obtained none."));
                return;
            }
            if(rows.length == 0) {
                successCallback(defaultvalue);
                return;
            }
            successCallback(rows.item(0));
        }, failureCallback);
    });
};

var datasources = {};

var registeredEvents = {};

var defaultDatasource = null;

function fire(eventname, arg0, arg1, arg2, arg3) {
    var handlers = registeredEvents[eventname];
    if(handlers) {
        for(var i = 0; i < handlers.length; i++) {
            var handler = handlers[i];
            handler(arg0, arg1, arg2, arg3);
        }
    }
}

/**
 * Allows to access a database. Returns an instance of DataSource.
 * @function db
 * @param {String} name The name of the database to access.
 * @example
 * var mydb = db("my");
 * mydb.list("get_people.sql").then(function(rows) {
 *     var index = 0;
 *     var row = null;
 *     var html = '';
 *     while((row = rows.item(index++)) != null) {
 *         html += row.first_name + " " + row.last_name + "<br>";
 *     }
 *     document.writeln(html);
 * });
 */
function DatabaseManager(name) {
    var ds = undefined;
    if(typeof(name) === 'undefined') {
        if(defaultDatasource) {
            ds = defaultDatasource;
        }
        else {
            for(var key in datasources) {
                ds = datasources[key];
                break;
            }
        }
    }
    else {
        ds = datasources[name];
    }

    fire('datasource_get', name, ds);
    return ds;
}

/**
 * Private name for the db function.
 * @class DatabaseManager
 */

/**
 * 
 * Registers a DataSource for use by this API.
 * A configuration object will describe how to access the database.
 * - *name* - The name that will be used to obtain access to the DataSource
 * - *isdefault* - When set to true, this DataSource will be returned when the db function is called without arguments
 * - *pluginName* - The cordova plugin that will be used to obtain access to the database. It must implement WebSQL methods
 * - *pluginConfig* - The configuration required by the plugin
 * - *queriespath* - The relative path to the queries that will be accessed while using this DataSource
 * @method register
 * @memberof DatabaseManager
 * @param {Object} config The options for the DataSource. The 'name' and 'queriespath' properties are required.
 * @example
 * db.register({
 *     name: 'my',
 *     isdefault: true,
 *     pluginName: 'window.sqlitePlugin',
 *     pluginConfig: {name: 'my.db.cipher', key: 'mypassword', location: 'default'},
 *     queriespath: 'queries/'
 * });
 *
 */
DatabaseManager.register = function(config) {
    datasources[config.name] = new DataSource(config);
    if(config.isdefault === true) {
        defaultDatasource = datasources[config.name];
    }
    fire('datasource_registered', config.name, datasources[config.name]);
};

DatabaseManager.on = function(eventname, callback) {
    if(!registeredEvents[eventname]) {
        registeredEvents[eventname] = [];
    }
    registeredEvents[eventname].push(callback);
};

DatabaseManager.un = function(eventname, callback) {
    if(!registeredEvents[eventname]) {
        registeredEvents[eventname] = [];
    }
    var idx = registeredEvents[eventname].indexof(callback);
    if(idx >= 0) {
        registeredEvents[eventname].splice(idx, 1);
    }
};


DatabaseManager.Exceptions = {
    FileNotFoundError: FileNotFoundError,
    TimeoutError: TimeoutError
};
DatabaseManager.Query = Query;
DatabaseManager.DataSource = DataSource;
DatabaseManager.QueryRunner = QueryRunner;
DatabaseManager.QueryParser = QueryParser;

module.exports = DatabaseManager;
