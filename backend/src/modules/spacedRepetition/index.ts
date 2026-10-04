import {Container, ContainerModule} from 'inversify';
import {sharedContainerModule} from '#root/container.js';
import {InversifyAdapter} from '#root/inversify-adapter.js';
import {RoutingControllersOptions, useContainer} from 'routing-controllers';
import {spacedRepetitionContainerModule} from './container.js';
import {ReviewController} from './controllers/ReviewController.js';
import {SPACED_REPETITION_VALIDATORS} from './classes/validators/ReviewValidators.js';
import {coursesContainerModule} from '#courses/container.js';
import {quizzesContainerModule} from '#quizzes/container.js';
import {usersContainerModule} from '#users/container.js';
import {authContainerModule} from '#auth/container.js';
import {notificationsContainerModule} from '#root/modules/notifications/container.js';
import {studentQuestionsContainerModule} from '#root/modules/studentQuestions/container.js';

// Spaced repetition reviews (#1047).
export const spacedRepetitionModuleControllers: Function[] = [ReviewController];

export const spacedRepetitionModuleValidators: Function[] =
  SPACED_REPETITION_VALIDATORS;

export const spacedRepetitionContainerModules: ContainerModule[] = [
  spacedRepetitionContainerModule,
  sharedContainerModule,
  coursesContainerModule,
  quizzesContainerModule,
  usersContainerModule,
  authContainerModule,
  notificationsContainerModule,
  studentQuestionsContainerModule,
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
