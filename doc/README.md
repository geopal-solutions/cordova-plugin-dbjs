# dbjs - Introduction #
dbjs is a minimalistic database access framework that will allow you to access databases from within your Cordova application while providing some templating functionality in order to prevent bad practices like mixing JavaScript code with SQL statements, which often leads to reduced maintainability as well as security issues.
It works by sitting on top of any WebSQL-based plugin, providing a simple API to perform the most common tasks.

## Features ##
* very compact syntax to run your queries
* reads the queries from files, thus separating JavaScript code from SQL statements
* automatic mapping of named parameters to positional ones, to avoid error-prone use of positional arguments
* a minimalistic templating engine to modify your queries based on supplied arguments
* support for advanced templating of queries through javascript
* support for migration of database versions, in order to automate updating your tables as necessary

## How to use it ##

### Step 1: configure the DataSource ###
The first step will be to configure a DataSource for use by the library. You can do it as shown in the following example:
```javascript
db.register({
    name: 'my',
    isdefault: true,
    pluginName: 'window.sqlitePlugin',
    pluginConfig: {name: 'my.db.cipher', key: 'mypassword', location: 'default'},
    queriespath: 'queries/'
});
```

Some remarks:
* Note that _pluginName_ is a string. This is required as the plugin may not have been initialised yet. When the query is run, the string will be resolved into a name.
* The _pluginConfig_ variable is passed directly to the plugin. As different plugins may need different configuration, its content will depend on the plugin.
* The _queriespath_ variable contains the base path for every query. Basically, a query named _hello.sql_ will have to live in _queries/hello.sql_.
* The _isdefault_ variable tells that this will be the default database. What this means you'll see later.



### Step 2: write your query ###
As the library is meant to separate JavaScript code from SQL code whie keeping things simple, each query will have its own file.

Call this file _hello.sql_ and put it in the _queries_ sub-directory.
```mysql
select
    first_name,
    last_name
from
    people
where
    first_name = :name
-- surname -- and last_name = :surname
```
The above assumes that your database has a table called _people_. If it doesn't, feel free to change the example or create such table.



### Step 3: execute the query ###
This one is dead easy:
```javascript
db().list("hello.sql", { name: "Filippo" }).then(function(rows) {
    var index = 0;
    var row = null;
    while((row = rows.item(index++)) != null) {
        console.log(row.first_name + " " + row.last_name);
    }
});
```

Note that the _db_ function is called without arguments. This will use the default datasource configured using _register_, if any. If you don't want to use the default datasource, just pass the function the name of the datasource you intend to use.

As you may have noticed, the _hello.sql_ query has a rather strange commented line with an sql condition. The comment part will be removed as soon as you put that parameter in your query, thus enabling you to write a single query for multiple parameter combinations. A query using both _name_ and _surname_ would be called as follows:
```javascript
db().list("hello.sql", { name: "Filippo", surname: "Possenti" }).then(function(rows) {
    var index = 0;
    var row = null;
    while((row = rows.item(index++)) != null) {
        console.log(row.first_name + " " + row.last_name);
    }
});
```

The above example will result in the query being processed and, ultimately, the following effectively run:
```mysql
select
    first_name,
    last_name
from
    people
where
    first_name = ?
 and last_name = ?
```

## Templating features ##
The following is a list of all supported text-templating features. These features are designed to enable the developer to easily implement frequent query scenarios without the need to mix javascript with sql.
Some of these features rely on sql comments being written in a specific way. The reason sql comments are used is that it makes easier to just copy/paste the query into a UI frontend to run the query and check if the syntax is correct.
While this templating mechanism does not aim to fulfill all possible scenarios, you should be able to fulfill most. Should you need more complex logic, you can leverage the ability of dbjs to use _.js_ files to render a query output.

### Named parameters ###
Parameters are to be passed to a query as a map. Whenever in the query the name of a key in said map is found preceded by colon, the string is converted into a positional argument and passed to the underlying engine for consumption.

For example, the following query contains multiple named parameters:
```mysql
select * from jobs
where
    id = :id
    and job_status_id = :job_status_id
```

When calling such query, you will have to provide an object structured as follow:
```javascript
{
    id: 123456,
    job_status_id: 1
}
```

This will result in the query being translated as follows:
```mysql
select * from jobs
where
    id = ?
    and job_status_id = ?
```

The engine, along with the query, will then be passed the following arguments:
```javascript
[ 123456, 1 ]
```

### Array expansion ###
Whenever an array is passed as value of a key in a set of query parameters, the array is expanded in the corresponding positional variables, separated by a comma. This feature is very useful to implement "in" clauses with multiple arguments.

For example, the following query contains an "in" clause:
```mysql
select * from jobs
where
    id = :id
    and job_status_id in (:job_status_id)
```

When calling it, you will have to provide an object structured as follows:
```javascript
{
    id: 123456,
    job_status_id: [ 1,2,3,4 ]
}
```

This will result in the query being translated as follows:
```mysql
select * from jobs
where
    id = ?
    and job_status_id in (?, ?, ?, ?)
```

The engine, along with the query, will then be passed the following arguments:
```javascript
[ 123456, 1, 2, 3, 4 ]
```



### Comment elision ###
This is the most useful feature of the templating engine. When a single-line comment, structured in a specific way is found at beginning of the line with inside just the name of a named parameter, the comment is removed, thus enabling the subsequent code. When the parameter is not provided, the whole line is removed in order to cleanup the query before execution.
This feature is most useful to write one query capable of allowing various combinations of filters. As the comment is removed only when the parameter is present, this makes very easy to write queries the conditions of which are added only when a certain parameter is provided.

For example, the following query contains some comments meant for elision when applicable:
```mysql
select * from jobs
where 1=1
-- id -- and id = :id
-- label -- and label = :label
-- worker -- and worker = :worker
```

When the query is passed for parameters an object containing the _id_ property, the resulting query will be as follows:
```mysql
select * from jobs
where 1=1
 and id = :id
```

When the query is NOT passed for parameters an object containing the _id_ property, the resulting query will be as follows:
```mysql
select * from jobs
where 1=1
```

Should you pass the following object:
```javascript
{
    label: "Repair",
    worker: "Filippo Possenti"
}
```

The resulting query will be as follows:
```mysql
select * from jobs
where 1=1
 and label = :label
 and worker = :worker
```


As you can see, the presence of a property triggers the removal of just the comment whereas its absence triggers the removal of the entire line, effectively changing the executed query.
This is very useful when used to write queries that support a variable set of parameters, as it avoids the need of writing different queries or the temptation to mix in the javascript file pieces of sql conditions


### Value-based comment elision ###
Whenever a comment-elision comment is found, the expected value can be provided following a colon in order to determine whether the elision should be applied or not.
This feature is useful to write queries that support only one sort condition at a time but with multiple sort conditions inside the same query.

For example, consider the following query:
```mysql
select * from jobs
order by
-- sort:job_status_id asc -- job_status_id asc
-- sort:job_status_id desc -- job_status_id desc
-- sort:id asc -- id asc
-- sort:id desc -- id desc
```

Depending on the provided parameters, one condition will be applied. For example:
```javascript
{ sort: "job_status_id asc" }
```
Will result in the following:
```mysql
select * from jobs
order by
 job_status_id asc
```

Note that there is a special way to handle _null_. Should you want to check for null, the syntax is as follows:
```mysql
-- myarg is null -- mycondition
```



### Token replacement ###
Whenever a text is embraced by curly braces, the corresponding key is expected to be found in the provided parameters. The value associated to the key is then injected directly into the query.
This feature is meant to compensate for the impossibility to inject parameters in certain positions of the queries.

**This feature comes with drawbacks in terms of security and safety. Please see the remarks at the end of the section.**

For example, consider the following query:
```mysql
select * from {my_table}
where id = :id
```

Should you pass the following object:
```javascript
{
    id: 123456,
    my_table: "jobs"
}
```

The resulting query will be as follows:
```mysql
select * from jobs
where id = ?
```

Note that the tokens can also be written as:
```mysql
{my_table|default}
```
In such case, everything following the pipe will be used as default value in case the provided token is not supplied.


**ATTENTION!!**
**Be very careful when using this feature, as it's designed to inject your custom pieces of SQL. In many cases, this may lead to SQL-injection. If you don't know what SQL-injection is, make sure to document yourself before using this feature as malicious use can lead to severe data-loss and business interruption.**


### Tips and tricks ###

The text-templating features described above will allow you to write most of your queries. As the engine is meant to be very simple, there are some tricks you may want to remember when writing your queries:
1. In the **WHERE clause**, if you have multiple AND conditions relying on **comment elision**, consider using **1=1** as the first condition
2. In the **WHERE** clause, if you have multiple OR conditions relying on **comment elision**, consider using **1=0** as the first condition
3. In the **WHERE** clause put the operator on the same line as the condition that would be enabled as part of the **comment elision**
4. In the **ORDER BY** clause, always put at the end a sorting by primary key. This will produce repeatable results for your users and will make easier injection of multiple sort conditions
5. In the **ORDER BY** clause, always put the coma on the same line as the condition that would be enabled as part of **comment elision**

The following query shows some of the tricks just described:
```mysql
select * from jobs
where 1=1                                              -- suggestion 1
-- id -- and id = :id                                  -- suggestion 3
-- job_status_id -- and job_status_id = :job_status_id -- suggestion 3
order by
-- sort_by_identifier -- identifier asc,               -- suggestion 5
-- sort_by_duration -- duration asc,                   -- suggestion 5
id desc                                                -- suggestion 4
```

## Advanced features ##

### Database migration ###

The library also comes with an embedded mechanism to allow migrating your database to newer versions, changing its structure.
The mechanism works by using a dedicated table on your database that will contain the version number for the DataSource. When you execute the _DataSource.upgrade_ method, a _.js_ file numbered after the current version + 1 will be looked up and executed if existing. Once its execution has completed, the version number will be incremented in the database table.
The migration script must follow a very specific naming convention (migration\_nnnnnnnn.js) and is required to live underneath a db\_migration subdirectory of the directory containing the queries. Each _DataSource_ will have its own dedicated directory underneath db\_migration.

Here follows an example:

```javascript
// The DataSource defined in your javascript
db.register({
    name: 'peopleds',
    isdefault: true,
    pluginName: 'window.sqlitePlugin',
    pluginConfig: {name: 'people.db.cipher', key: 'mypassword', location: 'default'},
    queriespath: 'queries/'
});
```

```javascript
// queries/db_migration/peopleds/migration_00000001.js file
return context.migration.executeScripts([
    "create_people_table.sql",
    "populate_people_table.sql"
]);
```

```mysql
-- queries/db_migration/peopleds/migration_00000001/create_people_table.sql
create table people
(
    first_name text,
    last_name text
)
```

```mysql
-- queries/db_migration/peopleds/migration_00000001/populate_people_table.sql
insert into people (first_name, last_name)
values ('Filippo', 'Possenti'), ('Sean', 'O''Reilly')
```

```javascript
// The script that will trigger the migration to create the table and query it afterwards
db("peopleds").upgrade().then(function(ds) {
    console.log("Migration completed.");
    return ds;
}).then(function(ds) {
    ds.list("hello.sql", { name: "Filippo" }).then(function(rows) {
        var index = 0;
        var row = null;
        while((row = rows.item(index++)) != null) {
            console.log(row.first_name + " " + row.last_name);
        }
    });
});
```

### Queries written in JavaScript ###
The main objective of dbjs is to enable easy querying while at the same time avoiding bad practices. One of the most common bad practices involves mixing your own business logic with the query itself, usually within the same JavaScript file. While such technique is often an indication of poorly conceived code, the usefulness of JavaScript in composing a query is undeniable as it allows for very complex logic and evaluation of the condition.
In order to enable developers to leverage the power of JavaScript while at the same time avoiding to fall into bad practices, dbjs allows to write queries in JavaScript. The developer will pass their queries the usual set of arguments and obtain results as usual, but in the middle the query will be transformed and generated by processing a custom JavaScript file. This mechanism represents the ultimate flexibility but should be used only on rather extreme scenarios.

Consider the following code:
```javascript
var queryargs = { name: "Filippo" };
var templateargs = { operator: "like", name: "Filippo" };
db().query("hello.sql", templateargs).list(queryargs).then(function(rows) {
    var index = 0;
    var row = null;
    while((row = rows.item(index++)) != null) {
        console.log(row.first_name + " " + row.last_name);
    }
});
```

```mysql
select
    first_name,
    last_name
from
    people
where 1=1
-- name -- and first_name {operator|=} :name
-- surname -- and last_name {operator|=} :surname
```

The query can be rewritten in JavaScript as follows:
```javascript
/* eval */
// The above comment is needed to tell dbjs to evaluate the query as javascript.
// Alternatively, the name of the query must end with .js rather than .sql
var query = "select first_name, last_name from people";
var operator = args.operator || '=';
var has_condition = false;
if(args.name) {
    has_condition = true;
    query += " where first_name " + operator + " :name";
}
if(args.surname) {
    if(has_condition) {
        query += " and";
    }
    else {
        query += " where";
    }
    query += " last_name " + operator + " :surname";
}
return query;
```

The query produced by the javascript version won't have the "weird" *1=1* condition, but as you can see is much harder to read and possibly maintain.
This example of course is not indicative of the real power of the JavaScript approach as it's meant to show how the feature rather than why. Understanding the very few scenarios where such technique is appropriate is up to the developer. In general, the advice is to try and stay away from it if at all possible.
