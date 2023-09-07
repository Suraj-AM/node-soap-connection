const soapClient = require('./module');

// WSDL ULR
const wsdlUrl = 'http://www.dneonline.com/calculator.asmx?wsdl'; // WSDL URL
// const wsdlUrl = 'http://webservices.oorsprong.org/websamples.countryinfo/CountryInfoService.wso?WSDL'; // WSDL URL

// Create an async function and invoke it
(async () => {
    try {
        const client = await soapClient.createClient(wsdlUrl);
        
        // Call the 'Add' SOAP method
        const result = await client.makeSoapRequest('Multiply', { intA: 12022, intB: 123132 });
        console.log('SOAP Response:', result);
    } catch (error) {
        console.error('Error:', error);
    }
})();