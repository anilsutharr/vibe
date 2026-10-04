import {ContainerModule} from 'inversify';
import {SPACED_REPETITION_TYPES} from './types.js';
import {ReviewItemRepository} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';

export const spacedRepetitionContainerModule = new ContainerModule(options => {
  // Repositories
  options
    .bind(SPACED_REPETITION_TYPES.ReviewItemRepo)
    .to(ReviewItemRepository)
    .inSingletonScope();
});
