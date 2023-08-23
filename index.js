const readline = require('readline');
const axios = require('axios');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let mainPrefix = '';
let definitionsKey = '';
let wsdlMessage = '';
let wsdlTypes = '';


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
        const wsdlObject = await parser.parseStringPromise(wsdlContent);

        // Find the appropriate prefix for "definitions"
        mainPrefix = getPrefix(wsdlObject, 'definitions');
        definitionsKey = mainPrefix + 'definitions';
        const portTypeKey = mainPrefix + 'portType';
        const operationKey = mainPrefix + 'operation';

        // Get port type, message and types from wsdl object
        const portType = wsdlObject[definitionsKey][portTypeKey][0][operationKey];
        wsdlMessage = wsdlObject[definitionsKey][mainPrefix + 'message'];
        wsdlTypes = wsdlObject[definitionsKey][mainPrefix + 'types'][0];

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


/* get prefix of string
* @param {Object} object
* @param {string} findingKey
* @return {string} prefix
*/
getPrefix = (object, findingKey) => {
    const prefix = Object.keys(object).filter(key => key.endsWith(findingKey))[0].split(":");
    return prefix.length > 1 ? prefix[0] + ':' : '';
};


/* get element from method
* @param {Object} methodInput
* @return {object} elements
*/
getMethodParameters = (methodInput) => {
    const schemaName = getSchemaName(methodInput);

    const types = wsdlTypes;

    const schemaPrefix = getPrefix(types, 'schema');
    const soapSchema = types[schemaPrefix + 'schema'][0];
    const arraySoapMethods = soapSchema[Object.keys(soapSchema).find(ele => ele != '$')];
    const parameters = arraySoapMethods.find(ele => ele.$.name == schemaName);

    const pathToLastElement = buildPathToElements(parameters, schemaPrefix);
    const elements = getElementAtPath(parameters, pathToLastElement);
    return elements;
};


/* get schema for method
* @param {Object} methodInput
* @return {string} schemaName
*/
getSchemaName = (methodInput) => {
    const wsdlMessageCopy = [...wsdlMessage];
    const schema = wsdlMessageCopy.find(ele => ele.$.name == methodInput);
    const schemaName = schema[mainPrefix + 'part'][0].$.element.split(":")[1];
    return schemaName;
};


/* create soap envelope and get wsdlXmlns
* @param {Object} methodInput
* @return {string} soapEnvelope
* @return {string} wsdlXmlns
*/
createSoapRequest = async (wsdlUrl, operationName, operationParameters, inputParameters) => {
    try {
        // Fetch the WSDL file content
        const response = await axios.get(wsdlUrl);
        const wsdlContent = response.data;

        // Parse the WSDL content
        const wsdlObject = await parser.parseStringPromise(wsdlContent);
        const wsdlXmlns = wsdlObject[definitionsKey]['$']['xmlns:tns'];

        // Construct the SOAP envelope with user-provided parameters
        const soapEnvelope = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="${wsdlXmlns}"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
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

    for (const param of inputParameters) {
        const paramName = param.$.name;
        const paramType = param.$.type;
        const userValue = userParameters[paramName];
        parameterString += `<web:${paramName} xsi:type="${paramType}">${userValue}</web:${paramName}>`;
    }

    return parameterString;
};


// Example usage
const wsdlUrl = 'http://www.dneonline.com/calculator.asmx?wsdl'; // WSDL URL

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
            const params = getMethodParameters(selectedMethod.input);
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
            const { soapEnvelope, wsdlXmlns } = await createSoapRequest(wsdlUrl, methodName, methodParameters, params);
            console.log('Generated SOAP Envelope:', soapEnvelope);

            // Make the SOAP request using axios
            axios.post(wsdlUrl, soapEnvelope, {
                headers: {
                    'Content-Type': 'text/xml',
                    'SOAPAction': wsdlXmlns + methodName
                },
            })
                .then(async response => {
                    // Parse the WSDL content
                    parser.parseString(response.data, (error, result) => {
                        if (error) {
                            console.error('Error parsing SOAP response:', error);
                        } else {
                            // Find result key and body key for response object
                            const resultKey = getMethodParameters(selectedMethod.output)[0].$.name;
                            const resultBody = getSchemaName(selectedMethod.output);
                            console.log('Parsed SOAP Response:', JSON.stringify(result['soap:Envelope']['soap:Body'][0][resultBody][0][resultKey][0]));
                        }
                    });
                })
                .catch(error => {
                    console.error('Error making SOAP request:', error);
                });

            // Add the method name, parameters, and input part to the same object
            const methodInfo = {
                methodName: methodName,
                parameters: methodParameters,
                inputPart: params ? params : ''
            };

            console.log('Method Info:', methodInfo);

            rl.close();
        });
    })
    .catch(error => {
        console.error(error);
    });
