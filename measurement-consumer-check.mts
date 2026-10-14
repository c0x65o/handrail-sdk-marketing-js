import { collectProviderMeasurement, MetaMeasurementClient, LinkedInMeasurementClient, materializeMeasurementWindow, readCampaignMeasurementRevisions, type CollectionOptions } from '@handrail/marketing/server';
export async function checkMeasurementConsumer(input: CollectionOptions) {
  const clients = [MetaMeasurementClient, LinkedInMeasurementClient];
  return {clients, materializeMeasurementWindow, readCampaignMeasurementRevisions, input: await collectProviderMeasurement(input)};
}
