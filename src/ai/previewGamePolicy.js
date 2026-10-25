import model from '#naval-preview-model';
import { PreviewDecisionHistory, PreviewPolicyRuntime } from './previewPolicyRuntime.js';

export const neuralPreview = true;
export const policyLabel = __NAVAL_PREVIEW_LABEL__;
export const policyMetadata = __NAVAL_PREVIEW_METADATA__;
const history = new PreviewDecisionHistory();
const runtime = new PreviewPolicyRuntime(model);

export const captureDecisionEvent = (...arguments_) => history.capture(...arguments_);
export const completeDecisionEvent = (...arguments_) => history.complete(...arguments_);
export const decisionHistoryContext = viewGrid => history.context(viewGrid);
export const makeAIDecisionAsync = context => runtime.decide(context);
export function resetAIState() {
    history.reset();
    runtime.reset();
}
