public with sharing class SalesForecastController {
    
    @AuraEnabled(cacheable=true)
    public static String getOrgId() {
        return UserInfo.getOrganizationId();
    }
    
    @AuraEnabled
    public static String fetchDealState(String opportunityId, String sfUserId) {
        String sfOrgId = UserInfo.getOrganizationId();
        String endpoint = 'https://forecast-agent-api.onrender.com/api/crm/salesforce/extension/token';
        
        HttpRequest req = new HttpRequest();
        req.setEndpoint(endpoint);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(10000);
        
        Map<String, String> body = new Map<String, String>{
            'sfOrgId'       => sfOrgId,
            'opportunityId' => opportunityId,
            'sfUserId'      => sfUserId
        };
        req.setBody(JSON.serialize(body));
        
        Http http = new Http();
        HttpResponse res = http.send(req);
        
        if (res.getStatusCode() == 200 || res.getStatusCode() == 401 || res.getStatusCode() == 404) {
            return res.getBody();
        }
        throw new AuraHandledException('API error: ' + res.getStatusCode() + ' ' + res.getStatus());
    }
}
