import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import Id from '@salesforce/user/Id';
import USER_EMAIL from '@salesforce/schema/User.Email';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import getOrgId from '@salesforce/apex/SalesForecastController.getOrgId';

const API_BASE = 'https://forecast-agent-api.onrender.com';

const CATEGORY_KEYS = [
    { key: 'pain',        label: 'Pain' },
    { key: 'metrics',     label: 'Metrics' },
    { key: 'champion',    label: 'Champion' },
    { key: 'eb',          label: 'EB' },
    { key: 'criteria',    label: 'Criteria' },
    { key: 'process',     label: 'Process' },
    { key: 'competition', label: 'Competition' },
    { key: 'paper',       label: 'Paper' },
    { key: 'timing',      label: 'Timing' },
    { key: 'budget',      label: 'Budget' },
];

function scoreVariant(score) {
    if (score >= 3) return 'success';
    if (score >= 2) return 'warning';
    return 'error';
}

function healthVariant(pct) {
    if (pct == null) return '';
    if (pct >= 70) return 'slds-theme_success';
    if (pct >= 40) return 'slds-theme_warning';
    return 'slds-theme_error';
}

function parseSummary(summary) {
    if (!summary) return { label: null, evidence: null };
    const colonIdx = summary.indexOf(':');
    if (colonIdx === -1) return { label: null, evidence: summary.trim() };
    return {
        label:    summary.slice(0, colonIdx).trim(),
        evidence: summary.slice(colonIdx + 1).trim(),
    };
}

function scoreBadgeClass(score) {
    const s = Number(score ?? 0);
    if (s >= 3) return 'slds-m-left_x-small slds-theme_success';
    if (s >= 2) return 'slds-m-left_x-small slds-theme_warning';
    return 'slds-m-left_x-small slds-theme_error';
}

export default class SalesForecastCard extends NavigationMixin(LightningElement) {
    @api recordId;

    @track _state   = 'loading'; // loading | ready | error
    @track _data    = null;
    @track _tokens  = null;
    @track _error   = null;
    @track _userEmail = null;
    @track _sfOrgId   = null;

    // Wire user email
    @wire(getRecord, { recordId: Id, fields: [USER_EMAIL] })
    wiredUser({ data, error }) {
        if (data) {
            this._userEmail = getFieldValue(data, USER_EMAIL);
            this._tryFetch();
        }
        if (error) {
            this._error = 'Could not load user information.';
            this._state = 'error';
        }
    }

    connectedCallback() {
        getOrgId()
            .then(orgId => {
                this._sfOrgId = orgId;
                this._tryFetch();
            })
            .catch(() => {
                // Fall back to hostname if Apex fails
                this._sfOrgId = window.location.hostname;
                this._tryFetch();
            });
    }

    _resolveOrgId() {
        // Org ID resolved via Apex controller — see connectedCallback
        return null;
    }

    _fetchAttempted = false;

    _tryFetch() {
        if (this._fetchAttempted) return;
        if (!this._userEmail || !this.recordId) return;
        this._fetchAttempted = true;
        this._fetchData();
    }

    async _fetchData() {
        this._state = 'loading';
        this._fetchAttempted = true;
        try {
            const res = await fetch(`${API_BASE}/api/crm/salesforce/extension/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sfOrgId:       this._sfOrgId || window.location.hostname,
                    opportunityId: this.recordId,
                    userEmail:     this._userEmail,
                }),
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || 'Token fetch failed');
            this._data   = json.dealState;
            this._tokens = { review: json.reviewToken, dashboard: json.dashboardToken };
            this._state  = 'ready';
        } catch (e) {
            this._error = String(e?.message || 'Failed to load deal data');
            this._state = 'error';
        }
    }

    handleRefresh() {
        this._fetchAttempted = false;
        this._error = null;
        this._state = 'loading';
        this._fetchData();
    }

    handleStartReview() {
        if (!this._tokens?.review) return;
        const url = `${API_BASE}/api/crm/salesforce/extension/session?token=${encodeURIComponent(this._tokens.review)}&mode=voice`;
        window.open(url, '_blank');
    }

    handleOpenDashboard() {
        if (!this._tokens?.dashboard) return;
        const url = `${API_BASE}/api/crm/salesforce/extension/dashboard?token=${encodeURIComponent(this._tokens.dashboard)}`;
        window.open(url, '_blank');
    }

    // -------------------------------------------------------------------------
    // Computed getters for template
    // -------------------------------------------------------------------------

    get isLoading() { return this._state === 'loading'; }
    get isReady()   { return this._state === 'ready'; }
    get isError()   { return this._state === 'error'; }
    get errorMessage() { return this._error || 'Unable to load deal data'; }

    get hasInitialHealth() {
        return this._data?.baseline_health_score != null;
    }
    get initialHealthLabel() {
        const pct = Math.round((Number(this._data?.baseline_health_score) / 30) * 100);
        return `Initial ${pct}%`;
    }
    get initialHealthClass() {
        const pct = Math.round((Number(this._data?.baseline_health_score) / 30) * 100);
        return `slds-m-right_x-small ${healthVariant(pct)}`;
    }

    get hasCurrentHealth() { return this._data?.health_pct != null; }
    get currentHealthLabel() { return `Health ${this._data?.health_pct}%`; }
    get currentHealthClass() {
        return `slds-m-right_x-small ${healthVariant(this._data?.health_pct)}`;
    }

    get hasVerdict() { return !!this._data?.ai_verdict; }
    get verdictLabel() { return `AI: ${this._data?.ai_verdict}`; }

    get categoryPills() {
        return CATEGORY_KEYS.map(c => ({
            key:       c.key,
            label:     c.label,
            badgeClass: scoreBadgeClass(this._data?.[`${c.key}_score`]),
        }));
    }

    get hasReviewRequest()      { return !!this._data?.review_request_note; }
    get reviewRequestNote()     { return this._data?.review_request_note; }
    get reviewRequestedByName() { return this._data?.review_requested_by_name; }

    get categoryDetails() {
        return CATEGORY_KEYS.map(c => {
            const score      = Number(this._data?.[`${c.key}_score`] ?? 0);
            const rawSummary = this._data?.[`${c.key}_summary`];
            const tip        = this._data?.[`${c.key}_tip`];
            const { label, evidence } = parseSummary(rawSummary);
            const scoreLabel = label || (
                score >= 3 ? 'Verified' :
                score >= 2 ? 'Credible' :
                score >= 1 ? 'Vague'    : 'Unknown'
            );
            return {
                key:        c.key,
                label:      c.label,
                score,
                scoreLabel,
                badgeClass: scoreBadgeClass(score),
                evidence:   evidence || null,
                tip:        (tip && score < 3) ? tip : null,
                hasData:    !!(evidence || tip),
            };
        });
    }

    get hasRiskSummary()     { return !!this._data?.risk_summary; }
    get hasNextSteps()       { return !!this._data?.next_steps; }
    get hasRiskOrNextSteps() { return this.hasRiskSummary || this.hasNextSteps; }
    get riskSummary()        { return this._data?.risk_summary; }
    get nextSteps()          { return this._data?.next_steps; }
}