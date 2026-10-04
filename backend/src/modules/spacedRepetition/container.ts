import {ContainerModule} from 'inversify';
import {SPACED_REPETITION_TYPES} from './types.js';
import {ReviewItemRepository} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';
import {ReviewService} from './services/ReviewService.js';
import {ReviewSeedingService} from './services/ReviewSeedingService.js';
import {ReviewController} from './controllers/ReviewController.js';

export const spacedRepetitionContainerModule = new ContainerModule(options => {
  // Repositories
  options
    .bind(SPACED_REPETITION_TYPES.ReviewItemRepo)
    .to(ReviewItemRepository)
    .inSingletonScope();

  // Services
  options
    .bind(SPACED_REPETITION_TYPES.ReviewService)
    .to(ReviewService)
    .inSingletonScope();
  options
    .bind(SPACED_REPETITION_TYPES.ReviewSeedingService)
    .to(ReviewSeedingService)
    .inSingletonScope();

  // Controllers
  options.bind(ReviewController).toSelf().inSingletonScope();
});
