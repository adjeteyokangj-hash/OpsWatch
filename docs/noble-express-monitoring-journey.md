# Noble Express monitoring journey

Noble Express is the first demonstration target; every step uses generic OpsWatch project, service, check, dependency and SLO APIs.

## Setup (no database edits)

1. Create the app project and its frontend/API/worker/provider monitored areas in the UI.
2. Add signed heartbeat/event credentials and an HTTP check against the real health endpoint.
3. Add upstream-to-downstream dependencies in **Dependencies & SLOs**.
4. Create an availability SLO and an active email or webhook notification channel.

## Demonstration record

Capture timestamps and resource IDs for: healthy check; induced real endpoint failure; alert; correlated incident; dependency evidence; top root-cause candidate; delivered notification; recovered check; resolved alert; recovery timeline entry; resolved incident; short/long SLO windows and consumed error budget.

Use the application or an approved staging fault switch to induce the failure. Do not mutate OpsWatch database records. The demonstration passes only when worker processing creates and resolves the resources automatically.

## Generic acceptance sequence

`healthy → failed check → alert → correlated incident → dependency impact → ranked cause → notification → recovery → timeline update → resolution → visible SLO impact`
