const axios = require('axios');
const xml2js = require('xml2js');
const parser = new xml2js.Parser();


class nodeSoapConnection {
    constructor() {
        // global variable declaration
        this.WSDLURL = '';
        this.wsdlObject = {};
        this.mainPrefix = '';
        this.wsdlMessage = '';
        this.schemaPrefix = '';
        this.soapMethods = {};
        this.wsdlSchema = [];
        this.wsdlXmlns = '';

    }

    /**
     * get methods from wsdl url
     * @param {URL} wsdlUrl
     * @return {array} soapMethods
     */
    async createClient(wsdlUrl) {
        try {
            this.WSDLURL = wsdlUrl;
            // Fetch the WSDL file content
            const response = await axios.get(wsdlUrl);
            const wsdlContent = response.data;

            // Parse the WSDL content
            this.wsdlObject = this.simplifyObject(await parser.parseStringPromise(wsdlContent));

            // Get wsdlXmlns
            const tnsKey = Object.keys(this.wsdlObject.$).find(ele => ele.endsWith('tns'));
            this.wsdlXmlns = this.wsdlObject.$[tnsKey];

            // Find the appropriate prefix for "definitions"
            this.mainPrefix = this.getPrefix(this.wsdlObject, 'portType');
            const portTypeKey = this.mainPrefix + 'portType';
            const operationKey = this.mainPrefix + 'operation';

            // Get port type, message and types from wsdl object
            const portType = this.wsdlObject[portTypeKey][operationKey];
            this.wsdlMessage = this.wsdlObject[this.mainPrefix + 'message'];
            const soapSchema = this.wsdlObject[this.mainPrefix + 'types'];

            // Find the schema from wsdl file
            const schemaKeys = Object.keys(soapSchema);
            const schemaFindingKey = schemaKeys.filter(ele => ele != '$');
            this.schemaPrefix = this.getPrefix(soapSchema, schemaFindingKey[0]);
            schemaKeys.forEach(ele => {
                if (schemaFindingKey.includes(ele)) {
                    this.wsdlSchema.push(...soapSchema[ele]);
                }
            });

            // Find the SOAP methods defined in the WSDL
            this.soapMethods = portType.map(method => {
                const methodName = method.$;
                const input = method[this.mainPrefix + 'input'].split(":").pop();
                const output = method[this.mainPrefix + 'output'].split(":").pop();
                return { name: methodName, input: input, output: output };
            });

            return;
        } catch (error) {
            throw error;
        }
    };


    /** 
     * get a path from object to the element key
     * @param {Object} schemaElement
     * @param {string} prefix
     * @param {array} path
     * @return {array} path
     */
    buildPathToElements(schemaElement, prefix, path = []) {
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
        return this.buildPathToElements(schemaElement[lastKey], prefix, newPath);
    };



    /**
     * get prefix of string
     * @param {Object} object
     * @param {string} findingKey
     * @return {string} prefix
     */
    getPrefix(object, findingKey) {
        const prefix = Object.keys(object).filter(key => key.endsWith(findingKey))[0].split(":");
        return prefix.length > 1 ? prefix[0] + ':' : '';
    };


    /**
     *  get element from object by path array
     * @param {Object} schemaElement
     * @param {array} path
     * @return {object} currentElement
     */
    getElementAtPath(schemaElement, path) {
        let currentElement = schemaElement;
        for (const step of path) {
            currentElement = currentElement[step];
        }
        return currentElement;
    };


    /**
     * get element from method
     * @param {Object} methodInput
     * @return {object} elements
     */
    getMethodParameters(methodInput) {
        // get schema name
        let nameSchema = this.getSchemaName(methodInput);
        if (!nameSchema) {
            nameSchema = methodInput; // if method is not defined in wsdl message
        }

        // find schema body
        const parameters = this.wsdlSchema.find(ele => ele.$ == nameSchema);
        if (!parameters) {
            return;
        }

        // get element Path
        const pathToLastElement = this.buildPathToElements(parameters, this.schemaPrefix);

        // fetch element at path
        const elements = this.getElementAtPath(parameters, pathToLastElement);
        if (!elements) {
            return;
        }

        const params = !Array.isArray(elements) ? [elements] : elements;

        if (params) {
            params.forEach(async (element) => {
                if (element && element.type.includes('tns')) {
                    const nextMethodInput = element.$.type.split(":").pop();
                    return await this.getMethodParameters(nextMethodInput);
                }
            });
        };

        return params;
    };


    /** 
     *  get schema for method
     * @param {Object} methodInput
     * @return {string} schemaName
     */
    getSchemaName(methodInput) {
        const schema = this.wsdlMessage.find((ele) => ele.$ == methodInput);
        if (!schema) {
            return;
        }
        const schemaName = schema[this.mainPrefix + 'part'].element.split(":").pop();
        return schemaName;
    };


    /**
     * remove extra array from object
     * @param {Object} object 
     * @returns {Object} final object after parsing
     */
    simplifyObject(object) {
        if (typeof object === 'object' && !Array.isArray(object)) {
            const keys = Object.keys(object);
            if (keys.length === 1) {
                // If only one key is available in object
                return this.simplifyObject(object[keys[0]]);

            } else {
                const result = {};

                for (const key of keys) {
                    result[key] = this.simplifyObject(object[key]);
                }

                return result;
            }
        } else if (Array.isArray(object)) {

            if (object.length === 1) {
                /** 
                 * if array have only one value
                 * then remove array and assign that value to parent key 
                 */
                return this.simplifyObject(object[0]);

            } else {

                return object.map((item) => this.simplifyObject(item));

            }
        } else {
            return object;
        }
    };


    /**
     * parse response and extract from soap envelope
     * @param {XMLHttpRequestResponseType} soapResponse 
     * @returns {Object} XMLHttpResponse
     */
    async parseResponse(soapResponse) {
        // parse the SOAP response
        const result = this.simplifyObject(await parser.parseStringPromise(soapResponse.data));

        // extract soap body from envelope
        const resultBody = result['soap:Body'];

        // filter '$' key from result
        const resultData = Object.fromEntries(
            Object.entries(resultBody).filter(([key, value]) => key != '$')
        );
        return resultData;
    };


    /**
     *  create soap envelope and get wsdlXmlns
     * @param {Object} methodInput
     * @return {string} soapEnvelope
     * @return {string} soap Envelope and wsdlXmlns
     */
    createSoapEnvelope(operationName, operationParameters, inputParameters) {
        try {

            // Construct the SOAP envelope with user-provided parameters
            const soapEnvelope = `
                <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="${this.wsdlXmlns}"
                xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
                    <soapenv:Header/>
                    <soapenv:Body>
                    <web:${operationName}>
                        ${this.constructParameters(operationParameters, inputParameters)}
                    </web:${operationName}>
                    </soapenv:Body>
                </soapenv:Envelope>
                `;

            return soapEnvelope;
        } catch (error) {
            throw error;
        }
    };


    /**
     * construct parameter for envelope
     * @param {object} userParameters
     * @param {object} inputParameters
     * @return {string} parameterString for envelope
     */
    constructParameters(userParameters, inputParameters) {
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


    /**
     * make call to SOAP serve
     */
    async makeCall(soapEnvelope, methodName, selectedMethodOutput) {
        let result = {};
        // Make the SOAP request using axios
        await axios.post(this.WSDLURL, soapEnvelope, {
            headers: {
                'Content-Type': 'text/xml',
                'SOAPAction': this.wsdlXmlns + methodName
            },
        }).then(async (response) => {
            result.status = response.status;
            result.data = await this.parseResponse(response, selectedMethodOutput);
        }).catch(async error => {
            const message = error.response.data;
            throw ({ status: error.response?.status, Error: message });
        });
        return result;
    }


    /**
     * Make SOAP Request
     * @param {String} methodName
     * @param {Object} arguments
     */
    async makeSoapRequest(methodName, args) {

        const selectedMethod = this.soapMethods.find(method => method.name === methodName);

        if (!selectedMethod) {
            throw ('Invalid method name.');
        }
        // get parameters from wsdl file
        const params = await this.getMethodParameters(selectedMethod.input);

        const methodParameters = {};

        if (params) {
            for (const param of params) {
                const paramName = param.name;
                methodParameters[paramName] = args[paramName];
            }
        }

        // generate envelope for soap call
        const soapEnvelope = this.createSoapEnvelope(methodName, methodParameters, params);

        const result = await this.makeCall(soapEnvelope, methodName, selectedMethod.output);

        return result;
    };
}



// export class instance
module.exports = nodeSoapConnection;