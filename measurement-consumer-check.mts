import { collectProviderMeasurement, MetaMeasurementClient, LinkedInMeasurementClient, materializeMeasurementWindow, readCampaignMeasurementRevisions, observedMeasurementSpend, readObservedMeasurementSpend, type CollectionOptions } from '@handrail/marketing/server';
export async function checkMeasurementConsumer(input: CollectionOptions) {
  const clients = [MetaMeasurementClient, LinkedInMeasurementClient];
  return {readObservedMeasurementSpend, observedMeasurementSpend, clients, materializeMeasurementWindow, readCampaignMeasurementRevisions, input: await collectProviderMeasurement(input)};
}
