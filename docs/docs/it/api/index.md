# Riferimento API

Il backend GNS-AIP espone endpoint REST per provisioning agenti, delega, manifesti, conformità e breadcrumb.

**URL Base:** `https://gns-browser-production.up.railway.app`

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| POST | `/agents/provision` | [Provisioning identità agente](/it/api/provision) |
| POST | `/agents/delegate` | [Crea certificato di delega](/it/api/delegate) |
| GET | `/agents/:id/manifest` | [Ottieni manifesto agente](/it/api/manifest) |
| GET | `/agents/:id/compliance` | [Interroga punteggio conformità](/it/api/compliance) |
| POST | `/agents/:id/breadcrumbs` | [Invia breadcrumb](/it/api/breadcrumbs) |
