export type PvcfcCollectionAccess = 'searchable' | 'discovery_only';

export interface PvcfcOrganizationSummary {
  readonly name: string;
  readonly sourceRecordId: string;
  readonly [key: string]: unknown;
}

export interface PvcfcCollectionSummary {
  readonly name: string;
  readonly access: PvcfcCollectionAccess;
  readonly count: number;
}

export interface PvcfcPublicRecord {
  readonly id: string;
  readonly originRefs: readonly string[];
  readonly [key: string]: unknown;
}

export interface PvcfcSearchHit {
  readonly collection: string;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly sourceUrl: string;
}

export interface PvcfcRecordLocator {
  readonly collection: string;
  readonly id: string;
  readonly title: string;
  readonly sourceUrl: string;
}

export interface PvcfcListCollectionsRequest {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface PvcfcListRecordsRequest {
  readonly collection: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface PvcfcSearchRecordsRequest {
  readonly query: string;
  readonly collections?: readonly string[];
  readonly limit?: number;
  readonly cursor?: string;
}

export interface PvcfcGetRecordRequest {
  readonly collection: string;
  readonly id: string;
}

export interface PvcfcCollectionPage {
  readonly revision: string;
  readonly capturedAt: string;
  readonly organization: PvcfcOrganizationSummary;
  readonly collections: readonly PvcfcCollectionSummary[];
  readonly nextCursor?: string;
}

export interface PvcfcSearchPage {
  readonly revision: string;
  readonly hits: readonly PvcfcSearchHit[];
  readonly nextCursor?: string;
}

export interface PvcfcRecordLocatorPage {
  readonly revision: string;
  readonly collection: string;
  readonly records: readonly PvcfcRecordLocator[];
  readonly nextCursor?: string;
}

export interface PvcfcRecordResult {
  readonly revision: string;
  readonly collection: string;
  readonly record: PvcfcPublicRecord;
}

export type PvcfcPublicDataErrorCode =
  | 'no_match'
  | 'invalid_request'
  | 'provider_unavailable'
  | 'provider_invalid'
  | 'cursor_stale';

export interface PvcfcPublicDataError {
  readonly code: PvcfcPublicDataErrorCode;
  readonly message: string;
}

export type PvcfcPublicDataResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PvcfcPublicDataError };

export interface PvcfcPublicDataProvider {
  listSourceUrls(): Promise<PvcfcPublicDataResult<readonly string[]>>;
  listCollections(
    request?: PvcfcListCollectionsRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcCollectionPage>>;
  listRecords(
    request: PvcfcListRecordsRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcRecordLocatorPage>>;
  searchRecords(
    request: PvcfcSearchRecordsRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcSearchPage>>;
  getRecord(
    request: PvcfcGetRecordRequest,
  ): Promise<PvcfcPublicDataResult<PvcfcRecordResult>>;
}
