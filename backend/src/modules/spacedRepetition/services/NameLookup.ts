import type {ICourseRepository} from '#shared/database/interfaces/ICourseRepository.js';
import type {IItemRepository} from '#shared/database/interfaces/IItemRepository.js';
import {
  ICourseVersion,
  IReviewItemVideoRef,
} from '#shared/interfaces/models.js';

/** The video to rewatch for a review, with names to show the student. */
export interface RelatedVideo extends IReviewItemVideoRef {
  videoName?: string;
  moduleName?: string;
  sectionName?: string;
}

/**
 * Looks up course and video names for one request, reading each course,
 * version and item at most once.
 */
export class NameLookup {
  private courses = new Map<string, Promise<string | undefined>>();
  private versions = new Map<string, Promise<ICourseVersion | null>>();
  private items = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly courseRepo: ICourseRepository,
    private readonly itemRepo: IItemRepository,
  ) {}

  courseName(courseId: string): Promise<string | undefined> {
    if (!this.courses.has(courseId)) {
      this.courses.set(
        courseId,
        this.courseRepo
          .read(courseId)
          .then(course => course?.name)
          .catch(() => undefined),
      );
    }
    return this.courses.get(courseId)!;
  }

  async relatedVideo(
    courseVersionId: string,
    ref: IReviewItemVideoRef | undefined,
  ): Promise<RelatedVideo | undefined> {
    if (!ref) {
      return undefined;
    }
    if (!this.versions.has(courseVersionId)) {
      this.versions.set(
        courseVersionId,
        this.courseRepo.readVersion(courseVersionId).catch(() => null),
      );
    }
    const version = await this.versions.get(courseVersionId)!;
    const module = version?.modules.find(
      m => m.moduleId?.toString() === ref.moduleId,
    );
    const section = module?.sections.find(
      s => s.sectionId?.toString() === ref.sectionId,
    );
    const itemKey = `${courseVersionId}:${ref.itemId}`;
    if (!this.items.has(itemKey)) {
      this.items.set(
        itemKey,
        this.itemRepo
          .readItem(courseVersionId, ref.itemId)
          .then(item => item?.name)
          .catch(() => undefined),
      );
    }
    return {
      ...ref,
      videoName: await this.items.get(itemKey)!,
      moduleName: module?.name,
      sectionName: section?.name,
    };
  }
}
