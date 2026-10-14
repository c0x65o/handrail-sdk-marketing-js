import { collectProviderMeasurement, MetaMeasurementClient, LinkedInMeasurementClient, materializeMeasurementWindow, readCampaignMeasurementRevisions, observedMeasurementSpend, type CollectionOptions } from '@handrail/marketing/server';
export async function checkMeasurementConsumer(input: CollectionOptions) {
  const clients = [MetaMeasurementClient, LinkedInMeasurementClient];
  return {observedMeasurementSpend, clients, materializeMeasurementWindow, readCampaignMeasurementRevisions, input: await collectProviderMeasurement(input)};
}
