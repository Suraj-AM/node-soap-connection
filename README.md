# node-soap-connection

### what is SOAP (Simple Object Access Protocol) API

SOAP is an acronym for Simple Object Access Protocol. It is an XML-based messaging protocol for exchanging information among computers. SOAP is an application of the XML specification.

> SOAP API takes message in XML format


### Way to connect to SOAP server
SOAP server provides wsdl file that defines all definitions of methods or API's.


**XML** format doesn't have any special way to write like other formats.
**WSDL** file can written in any way.

#### common keywords in WSDL file
1. **definitions** - outer layer / root element of wsdl file or xml. Gives basic information about server.
2. **service** - provides more information about server like address port etc.
3. **prototype** - Definitions of _methods_ of server with reference to _input_ and _output_ type. _input_ and _output_ refer to **message** in file
4. **message** - Here _part_ tag we get name of **schema** for input / output
5. **types** - It contains type descriptive data of wsdl file
6. **schema** - main definitions of data or name and types of data will get here


As this is basic syntax of wsdl file. Inside it can be more complex like reference for schemas. It will always jumping like structure.

> Their are may more information define in definitions tag
like its encoding type, name, and several link that defines SOAP format of xml

1. xmlns="http://schemas.xmlsoap.org/wsdl/"
2. xmlns:xs="http://www.w3.org/2001/XMLSchema"
3. xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
4. xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
5. xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"

This link mainly seen in wsdl definitions tag.

As xml does not have nay specific format so this tags may be contains prefix to it like **wsdl:definitions**. But in schema it may be different prefix.
Like html xml have to close their tags as same html like
> < wsdl:definition > < / wsdl:definition >

### Make connection or call SOAP method
We can make call using axios it takes **wsdl url** and for body we have to provide message in xml **envelope** 

### Format of ENVELOPE
Envelope conation similar tags like html like

First _**envelope**_ followed by _**header**_ and after it closed _**body**_ of envelope. Like definition in wsdl file envelope is root element of it

### XML basic format for SOAP ENVELOPE
```
<?xml version = "1.0"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV = "http://www.w3.org/2001/12/soap-envelope" 
   SOAP-ENV:encodingStyle = "http://www.w3.org/2001/12/soap-encoding">

   <SOAP-ENV:Header>
      ...
      ...
   </SOAP-ENV:Header>
   <SOAP-ENV:Body>
      ...
      ...
      <SOAP-ENV:Fault>
         ...
         ...
      </SOAP-ENV:Fault>
      ...
   </SOAP-ENV:Body>
</SOAP_ENV:Envelope>
```

##### Envelope:
Defines the start and the end of the message. It is a mandatory element.

##### Header:
Contains any optional attributes of the message used in processing the message, either at an intermediary point or at the ultimate end-point. It is an optional element.

##### Body:
Contains the XML data comprising the message being sent. It is a mandatory element.

##### Fault:
An optional Fault element that provides information about errors that occur while processing the message.
IT will shows in response from server.
		
> Fault Code: It defines code of error on server

> Fault Message: It defines message / reason for Fault or error