# HubSpot Embed Setup

## Render Environment Variable (web service)

Add this variable in Render -> your web service -> Environment:

  EMBED_COOKIE_SAME_SITE = none

This is required for the iframe cookie to work in HubSpot.
For future CRM embeds that use a different iframe model,
change this value to: lax or strict.

## Prerequisites
- HubSpot Sales Hub Professional or Enterprise
- SalesForecast HubSpot integration connected and initial sync completed

## HubSpot Configuration Steps

### 1. Note your SalesForecast domain
  https://{your-render-domain}.onrender.com

### 2. Add a Custom Tab to Deal Records
1. Go to HubSpot -> Settings -> Objects -> Deals -> Record Customization
2. Click "Customize record" on your deal layout
3. Add a new tab, name it: SalesForecast
4. Set the iframe URL to:
   https://{your-render-domain}.onrender.com/embed/hubspot?portalId={{portal_id}}&dealId={{objectId}}

   Note: {{portal_id}} and {{objectId}} are HubSpot template
   variables - paste them literally, HubSpot replaces them at runtime.

5. Save and publish the layout

### 3. Verify
1. Open any synced deal in HubSpot
2. Click the SalesForecast tab
3. The Matthew scorecard loads within 2-3 seconds
4. Voice and text reviews work directly from the tab

## Notes

- Sessions expire after 1 hour. HubSpot re-renders on each tab open,
  generating a fresh session automatically. No manual re-login needed.
- The embed creates one service account user per org (role: REP,
  hierarchy_level: 3). This user appears in your users table as
  embed-hubspot-{orgId}@internal.salesforecast.io
- Voice reviews require microphone permission inside the HubSpot
  iframe. Chrome grants this automatically. Safari requires the user
  to allow microphone on first use.
- This embed architecture is CRM-agnostic. For Dynamics or SFDC
  embeds, create web/app/embed/dynamics/page.tsx and
  web/app/embed/sfdc/page.tsx following the same pattern.
  Each CRM gets its own entry point and resolveXxxDeal function
  in embedAuth.ts.
