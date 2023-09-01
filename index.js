const readline = require('readline');
const axios = require('axios');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});


// global variable declaration
let wsdlObject;
let mainPrefix = '';
let definitionsKey = '';
let wsdlMessage = '';
let wsdlSchema = [];
let schemaPrefix = '';

/* get methods from wsdl url
* @param {URL} wsdlUrl
* @return {array} soapMethods
*/
getSoapMethods = async (wsdlUrl) => {
    try {
        // Fetch the WSDL file content
        const response = await axios.get(wsdlUrl);
        const wsdlContent = response.data;

        // Parse the WSDL content
        wsdlObject = await parser.parseStringPromise(wsdlContent);

        // Find the appropriate prefix for "definitions"
        mainPrefix = getPrefix(wsdlObject, 'definitions');
        definitionsKey = mainPrefix + 'definitions';
        const portTypeKey = mainPrefix + 'portType';
        const operationKey = mainPrefix + 'operation';

        // Get port type, message and types from wsdl object
        const portType = wsdlObject[definitionsKey][portTypeKey][0][operationKey];
        wsdlMessage = wsdlObject[definitionsKey][mainPrefix + 'message'];
        const wsdlTypes = wsdlObject[definitionsKey][mainPrefix + 'types'][0];

        // Find the schema from wsdl file
        schemaPrefix = getPrefix(wsdlTypes, 'schema');
        const soapSchema = wsdlTypes[schemaPrefix + 'schema'][0];
        Object.keys(soapSchema).forEach(ele => {
            if (ele != '$') {
                wsdlSchema.push(...soapSchema[ele]);
            }
        });

        // Find the SOAP methods defined in the WSDL
        const soapMethods = portType.map(method => {
            const methodName = method.$.name;
            const input = method[mainPrefix + 'input'][0].$.message.split(":")[1];
            const output = method[mainPrefix + 'output'][0].$.message.split(":")[1];
            return { name: methodName, input: input, output: output };
        });

        return soapMethods;
    } catch (error) {
        throw error;
    }
};


/* get a path from object to the element key
* @param {Object} schemaElement
* @param {string} prefix
* @param {array} path
* @return {array} path
*/
buildPathToElements = (schemaElement, prefix, path = []) => {
    if (!schemaElement || typeof schemaElement !== 'object') {
        return path;
    }

    const keys = Object.keys(schemaElement);
    if (keys.length === 0) {
        return path;
    }

    if (keys.includes(prefix + 'element')) {
        path.push(prefix + 'element');
        return path;
    }

    const lastKey = keys.find(key => key !== '$');
    if (!lastKey) {
        return path;
    }

    const newPath = [...path, isNaN(Number(lastKey)) ? lastKey : Number(lastKey)];
    return buildPathToElements(schemaElement[lastKey], prefix, newPath);
};


/* get prefix of string
* @param {Object} object
* @param {string} findingKey
* @return {string} prefix
*/
getPrefix = (object, findingKey) => {
    const prefix = Object.keys(object).filter(key => key.endsWith(findingKey))[0].split(":");
    return prefix.length > 1 ? prefix[0] + ':' : '';
};


/* get element from object by path array
* @param {Object} schemaElement
* @param {array} path
* @return {object} currentElement
*/
getElementAtPath = (schemaElement, path) => {
    let currentElement = schemaElement;
    for (const step of path) {
        currentElement = currentElement[step];
    }
    return currentElement;
};


/* get element from method
* @param {Object} methodInput
* @return {object} elements
*/
getMethodParameters = async (methodInput) => {
    // get schema name
    let nameSchema = await getSchemaName(methodInput);
    if (!nameSchema) {
        nameSchema = methodInput;
    }

    // find schema body
    const parameters = wsdlSchema.find(ele => ele.$.name == nameSchema);
    const pathToLastElement = buildPathToElements(parameters, schemaPrefix);

    // fetch element at that path
    const elements = getElementAtPath(parameters, pathToLastElement);

    if (elements && elements[0].$.type.includes('tns')) {
        const nextMethodInput = elements[0].$.type.split(":").pop();
        return await getMethodParameters(nextMethodInput);
    }

    return { params: elements, method: methodInput };
};


/* get schema for method
* @param {Object} methodInput
* @return {string} schemaName
*/
getSchemaName = (methodInput) => {
    const schema = wsdlMessage.find((ele) => ele.$.name == methodInput);
    if (!schema) {
        return;
    }
    const schemaName = schema[mainPrefix + 'part'][0].$.element.split(":")[1];
    return schemaName;
};


/* Get name of response from wsdl schema
* @param {string} schemaName
* @param {string} prefix - prefix of response
* @return {string} response name
*/
getNameOfResponse = (schemaName, prefix) => {
    const schema = wsdlSchema.find(ele => ele.$.name.endsWith(schemaName));
    const path = buildPathToElements(schema, prefix);
    const ele = getElementAtPath(schema, path);
    return ele.$.name;
};


parseResponse = async (soapResponse, output) => {
    // parse the SOAP response
    const result = await parser.parseStringPromise(soapResponse.data);

    // extract soap body from envelope
    const resultBody = result['soap:Envelope']['soap:Body'][0];

    // get result parameters and method name
    const { params, method } = await getMethodParameters(output);

    // find prefix of response elements
    const ResultKeys = Object.keys(resultBody)[0];
    const prefix = ResultKeys.includes(":") ? ResultKeys.split(":")[0] + ':' : '';

    // get response name and response element name
    const responseSchema = getSchemaName(output);
    const responseElementName = getNameOfResponse(responseSchema, prefix);

    // extract parameter name
    const parameters = params.map(ele => ele.$.name);

    // get result data from body
    const resultData = resultBody[prefix + responseSchema][0][prefix + responseElementName][0][prefix + method];
   
    const jsonData = [];

    // iterate through the result data
    resultData.forEach(item => {
        const convertedItem = {};
        // iterate through the parameters array and extract values from the result
        parameters.forEach(param => {
            const paramName = prefix + param;
            const paramValue = item[paramName][0];

            convertedItem[param] = paramValue;
        });

        jsonData.push(convertedItem);
    });
    return jsonData;
};


/* create soap envelope and get wsdlXmlns
* @param {Object} methodInput
* @return {string} soapEnvelope
* @return {string} wsdlXmlns
*/
createSoapRequest = (operationName, operationParameters, inputParameters) => {
    try {

        // Parse the WSDL content
        const wsdlXmlns = wsdlObject[definitionsKey]['$']['xmlns:tns'];

        // Construct the SOAP envelope with user-provided parameters
        const soapEnvelope = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="${wsdlXmlns}"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
        <soapenv:Header/>
        <soapenv:Body>
          <web:${operationName}>
            ${constructParameters(operationParameters, inputParameters)}
          </web:${operationName}>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

        return { soapEnvelope, wsdlXmlns };
    } catch (error) {
        throw error;
    }
};


/* construct parameter for envelope
* @param {object} userParameters
* @param {object} inputParameters
* @return {string} parameterString
*/
constructParameters = (userParameters, inputParameters) => {
    let parameterString = '';
    if (inputParameters) {
        for (const param of inputParameters) {
            const paramName = param.$.name;
            const paramType = param.$.type;
            const userValue = userParameters[paramName];
            parameterString += `<web:${paramName} xsi:type="${paramType}">${userValue}</web:${paramName}>`;
        }
    }
    return parameterString;
};


// WSDL ULR
const wsdlUrl = 'http://www.dneonline.com/calculator.asmx?wsdl'; // WSDL URL
// const wsdlUrl = 'http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso?WSDL'; // WSDL URL

getSoapMethods(wsdlUrl)
    .then(async (methods) => {
        console.log('Available SOAP Methods:', methods);

        rl.question('Enter the name of the SOAP method you want to call: ', async (methodName) => {
            const selectedMethod = methods.find(method => method.name === methodName);

            if (!selectedMethod) {
                console.log('Invalid method name.');
                rl.close();
                return;
            }
            // get parameters from wsdl file
            const { params } = await getMethodParameters(selectedMethod.input);

            const methodParameters = {};

            if (params) {
                for (const param of params) {
                    const paramName = param.$.name;
                    const paramType = param.$.type;
                    const paramValue = await new Promise((resolve) => {
                        rl.question(`Enter value for parameter '${paramName}' (${paramType}): `, (value) => {
                            resolve(value);
                        });
                    });
                    methodParameters[paramName] = paramValue;
                }
            }

            // generate envelope for soap call
            const { soapEnvelope, wsdlXmlns } = await createSoapRequest(methodName, methodParameters, params);
            console.log('Generated SOAP Envelope:', soapEnvelope);

            // Make the SOAP request using axios
            await axios.post(wsdlUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'text/xml',
                    'SOAPAction': wsdlXmlns + methodName
                },
            }).then(async response => {
                const result = await parseResponse(response, selectedMethod.output);
                console.log('Parsed SOAP Response:', JSON.stringify(result, null, 2));

            }).catch(error => {
                console.log(error);
                console.error('Error making SOAP request: status:- ', error.response?.status);
                console.error('Error body:-', error.response?.data);
            });

            // Add the method name, parameters, and input part to the same object
            const methodInfo = {
                methodName: methodName,
                parameters: methodParameters
            };

            console.log('Method Info:', methodInfo);

            rl.close();
        });
    })
    .catch(error => {
        console.error(error);
    });
