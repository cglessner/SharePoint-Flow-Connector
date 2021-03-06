var request = require("request");
var Promise = require('promise');

module.exports = function (context, req) {

    context.log('UpdateListItem HTTP trigger is processing a request...');
    context.log.verbose("Headers: %j", context.req.headers);

    var token = req.headers.authorization || req.headers["x-ms-token-aad-access-token"] || null;

    if (typeof token == 'undefined') {
        context.log('End processing because no access token was found.');
        context.res = {
            status: 401,
            body: "Unauthorized: No access token!"
        };
        context.done();
        return;
    }

    if (!token.toLowerCase().startsWith("bearer")) token += "Bearer ";

    var webUrl = req.query.webUrl || null;
    var listName = req.query.listName || null;
    var query = req.query.query || "";
    var id = req.query.id || null;

    context.log('Query parameters: webUrl: "%s" listName: "%s"  id: "%s"', webUrl, listName, id);

    if (webUrl == null || listName == null || id == null) {
        context.res = {
            status: 400,
            body: "Query parameters webUrl, listName and id are required."
        };
        context.done();
        return;
    }

    var regex = new RegExp(/"@user\(([\w\W]+?)\)"?/, "g");

    var body = typeof req.body == 'string' ? req.body : JSON.stringify(req.body);
    var results = body.match(regex);

    var regex2 = new RegExp(/[a-zA-Z-_\d@.]+/, "g");

    var promises = [];
    if (results) {
        results.forEach((x) => {
            promises.push(resolveUser(context, webUrl, x.match(regex2)[1], token).then((id) => {
                body = body.replace(x, id);
            }));
        });
    }
    Promise.all(promises).then((a) => {

        var restUrl = webUrl + "/_api/web/Lists/GetByTitle('" + listName + "')/GetItemById(" + id + ")";

        var options = {
            url: restUrl,
            headers: {
                'Content-Type': "application/json;odata=verbose",
                'Accept': "application/json;odata=verbose",
                'Authorization': token,
                'If-Match': '*'
            },
            body: body
        };

        var resp = request.patch(options, function (error, response, body) {

            context.log.verbose("SharePoint Response: %j", response);
            if (response.statusCode != 200 && response.statusCode != 204 || error != null) {
                if (response.statusCode == 401) {
                    context.res = {
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: {
                            error: "Unauthorized"
                        },
                        statusCode: response.statusCode
                    };
                    context.done();
                    return;
                }

                if (response.statusCode == 404) {
                    context.res = {
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: {
                            error: "Not found"
                        },
                        statusCode: response.statusCode
                    };
                    context.done();
                    return;
                }

                context.log("SharePoint Error: %j", response);
                context.res = {
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: {
                        error: JSON.parse(body).error.message.value
                    },
                    statusCode: response.statusCode
                };
                context.done();
                return;
            }
            else {
                context.done();
            }
        });
    }).catch((error) => {
        context.res = {
            headers: {
                "Content-Type": "application/json"
            },
            body: {
                error: error
            },
            statusCode: 500
        };
        context.done();
        return;
    });

};


function resolveUser(context, webUrl, userName, token) {

    context.log("Resolve user: " + userName);

    return new Promise(function (fulfill, reject) {

        var prefix = "i:0#.f|membership|";
        var accountName = prefix + userName;

        ensureUser(context, webUrl, accountName, token).then(() => {
            context.log("Ensure user: " + accountName);

            var restUrl = webUrl + "/_api/web/siteusers(@v)?@v='" + encodeURIComponent(accountName) + "'";
            var options = {
                url: restUrl,
                headers: {
                    'Content-Type': "application/json;odata=verbose",
                    'Accept': "application/json;odata=verbose",
                    'Authorization': token,
                }
            };

            request.get(options, function (error, response, body) {
                if (response.statusCode == 200) {
                    var id = JSON.parse(body).d.Id;
                    context.log("User: " + accountName + " was resolved with ID: " + id);
                    fulfill(id);
                }
                else {
                    context.log("User: " + accountName + " could npt be resolved!");
                    context.log(response);
                    reject(JSON.parse(body).error.message.value);
                }
            });

        });

    });
}


function ensureUser(context, webUrl, accountName, token) {

    return new Promise(function (fulfill, reject) {
        var restUrl = webUrl + "/_api/web/ensureuser('" + encodeURIComponent(accountName) + "')";

        var options = {
            url: restUrl,
            headers: {
                'Content-Type': "application/json;odata=verbose",
                'Accept': "application/json;odata=verbose",
                'Authorization': token,
            }
        };

        request.post(options, function (error, response, body) {
            if (response.statusCode == 200) {
                context.log("Ensure user: " + accountName + " -> successfull.");
                fulfill();
            }
            else {
                context.log("Ensure user: " + accountName + " -> failed.");
                context.log(response);
                reject(JSON.parse(body).error.message.value);
            }
        });
    });
}