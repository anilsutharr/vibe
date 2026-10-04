import {Container, ContainerModule} from 'inversify';
import {sharedContainerModule} from '#root/container.js';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {RoutingControllersOptions, useContainer} from 'routing-controllers';
import {spacedRepetitionContainerModule} from './container.js';

// Spaced repetition reviews (#1047). The review API controllers are added in a
// follow-up; until then the module only provides its repository and the SM-2
// utilities.
export const spacedRepetitionModuleControllers: Function[] = [];

export const spacedRepetitionContainerModules: ContainerModule[] = [
  spacedRepetitionContainerModule,
  sharedContainerModule,
];

export async function setupSpacedRepetitionContainer(): Promise<void> {
  const container = new Container();
  await container.load(...spacedRepetitionContainerModules);
  const inversifyAdapter = new InversifyAdapter(container);
  useContainer(inversifyAdapter);
}

export const spacedRepetitionModuleOptions: RoutingControllersOptions = {
  controllers: spacedRepetitionModuleControllers,
  middlewares: [],
  defaultErrorHandler: true,
  authorizationChecker: async function () {
    return true;
  },
  validation: true,
};

export * from './constants.js';
export * from './container.js';
export * from './types.js';
export * from './utils/applySm2.js';
export * from './utils/getNextReviewDate.js';
