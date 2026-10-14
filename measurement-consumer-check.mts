import { collectProviderMeasurement, MetaMeasurementClient, LinkedInMeasurementClient, type CollectionOptions } from '@handrail/marketing/server';
export async function checkMeasurementConsumer(input: CollectionOptions) {
  const clients = [MetaMeasurementClient, LinkedInMeasurementClient];
  return {clients, input: await collectProviderMeasurement(input)};
}
