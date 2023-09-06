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
let wsdlMessage = '';
let wsdlSchema = [];
let schemaPrefix = '';

/* get methods from wsdl url
* @param {URL} wsdlUrl
* @return {array} soapMethods
*/
const getSoapMethods = async (wsdlUrl) => {
    try {
        // Fetch the WSDL file content
        const response = await axios.get(wsdlUrl);
        const wsdlContent = response.data;

        // Parse the WSDL content
        wsdlObject = simplifyObject(await parser.parseStringPromise(wsdlContent));

        // Find the appropriate prefix for "definitions"
        mainPrefix = getPrefix(wsdlObject, 'portType');
        definitionsKey = mainPrefix + 'definitions';
        const portTypeKey = mainPrefix + 'portType';
        const operationKey = mainPrefix + 'operation';

        // Get port type, message and types from wsdl object
        const portType = wsdlObject[portTypeKey][operationKey];
        wsdlMessage = wsdlObject[mainPrefix + 'message'];
        const soapSchema = wsdlObject[mainPrefix + 'types'];

        // Find the schema from wsdl file
        const schemaKeys = Object.keys(soapSchema);
        const schemaFindingKey = schemaKeys.filter(ele => ele != '$');
        schemaPrefix = getPrefix(soapSchema, schemaFindingKey[0]);
        schemaKeys.forEach(ele => {
            if (schemaFindingKey.includes(ele)) {
                wsdlSchema.push(...soapSchema[ele]);
            }
        });

        // Find the SOAP methods defined in the WSDL
        const soapMethods = portType.map(method => {
            const methodName = method.$;
            const input = method[mainPrefix + 'input'].split(":").pop();
            const output = method[mainPrefix + 'output'].split(":").pop();
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
const buildPathToElements = (schemaElement, prefix, path = []) => {
    if (!schemaElement || typeof schemaElement !== 'object') {
        return path;
    }

    const keys = Object.keys(schemaElement);
    if (keys.length === 0) {
        return path;
    }

    if (keys.includes('type')) {
        return path;
    }

    if (keys.every((element) => !isNaN(Number(element)))) {
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
const getPrefix = (object, findingKey) => {
    const prefix = Object.keys(object).filter(key => key.endsWith(findingKey))[0].split(":");
    return prefix.length > 1 ? prefix[0] + ':' : '';
};


/* get element from object by path array
* @param {Object} schemaElement
* @param {array} path
* @return {object} currentElement
*/
const getElementAtPath = (schemaElement, path) => {
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
const getMethodParameters = async (methodInput) => {
    // get schema name
    let nameSchema = await getSchemaName(methodInput);
    if (!nameSchema) {
        nameSchema = methodInput;
    }

    // find schema body
    const parameters = wsdlSchema.find(ele => ele.$ == nameSchema);
    if (!parameters) {
        return { method: methodInput };
    }
    const pathToLastElement = buildPathToElements(parameters, schemaPrefix);

    // fetch element at that path
    const elements = getElementAtPath(parameters, pathToLastElement);
    if (!elements) {
        return { method: methodInput };
    }
    const params = !Array.isArray(elements) ? [elements] : elements;

    if (params) {
        params.forEach(async (element) => {
            if (element && element.type.includes('tns')) {
                const nextMethodInput = element.$.type.split(":").pop();
                return await getMethodParameters(nextMethodInput);
            }
        });
    };

    return { params: params, method: methodInput };
};


/* get schema for method
* @param {Object} methodInput
* @return {string} schemaName
*/
const getSchemaName = (methodInput) => {
    const schema = wsdlMessage.find((ele) => ele.$ == methodInput);
    if (!schema) {
        return;
    }
    const schemaName = schema[mainPrefix + 'part'].element.split(":").pop();
    return schemaName;
};


const simplifyObject = (obj) => {
    if (typeof obj === 'object' && !Array.isArray(obj)) {
        const keys = Object.keys(obj);
        if (keys.length === 1) {
            return simplifyObject(obj[keys[0]]);
        } else {
            const result = {};
            for (const key of keys) {
                result[key] = simplifyObject(obj[key]);
            }
            return result;
        }
    } else if (Array.isArray(obj)) {
        if (obj.length === 1) {
            return simplifyObject(obj[0]);
        } else {
            return obj.map((item) => simplifyObject(item));
        }
    } else {
        return obj;
    }
};



const parseResponse = async (soapResponse, output) => {
    // parse the SOAP response
    const result = simplifyObject(await parser.parseStringPromise(soapResponse.data));

    // extract soap body from envelope
    const resultBody = result['soap:Body'];

    // get result data from body
    const resultData = Object.fromEntries(
        Object.entries(resultBody).filter(([key, value]) => key != '$')
    );
    return resultData;
};


/* create soap envelope and get wsdlXmlns
* @param {Object} methodInput
* @return {string} soapEnvelope
* @return {string} wsdlXmlns
*/
const createSoapRequest = (operationName, operationParameters, inputParameters) => {
    try {

        // Parse the WSDL content
        const wsdlXmlns = wsdlObject.$['xmlns:tns'];

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
const constructParameters = (userParameters, inputParameters) => {
    let parameterString = '';
    if (inputParameters) {
        for (const param of inputParameters) {
            const paramName = param.name;
            const paramType = param.type;
            const userValue = userParameters[paramName];
            parameterString += `<web:${paramName} type="${paramType}">${userValue}</web:${paramName}>`;
        }
    }
    return parameterString;
};


// WSDL ULR
// const wsdlUrl = 'http://www.dneonline.com/calculator.asmx?wsdl'; // WSDL URL
const wsdlUrl = 'http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso?WSDL'; // WSDL URL

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
                    const paramName = param.name;
                    const paramType = param.type;
                    const paramValue = await new Promise((resolve) => {
                        rl.question(`Enter value for parameter '${paramName}' (${paramType}): `, (value) => {
                            resolve(value);
                        });
                    });
                    methodParameters[paramName] = paramValue;
                }
            }

            // generate envelope for soap call
            const { soapEnvelope, wsdlXmlns } = createSoapRequest(methodName, methodParameters, params);
            console.log('Generated SOAP Envelope:', soapEnvelope);

            // Make the SOAP request using axios
            await axios.post(wsdlUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'text/xml',
                    'SOAPAction': wsdlXmlns + methodName
                },
            }).then(async response => {
                console.log('SOAP Response:', response.data);
                const result = await parseResponse(response, selectedMethod.output);
                console.log('Parsed SOAP Response:',response.status, JSON.stringify(result, null, 2));

            }).catch(error => {
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
