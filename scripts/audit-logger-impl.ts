/**
 * Audit Logger - Implementation
 * 
 * This module provides the FileAuditLogger implementation that writes audit entries
 * to JSONL format files with retry and fallback mechanisms.
 * 
 * Requirements: R16.1, R16.2, R16.3, R16.4, R16.5
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ok, err, Result } from './state-controller';
import {
  AuditLogger,
  AuditLoggerConfig,
  AuditEntry,
  AuditError,
  LogResult,
  QueryResult,
  ArchiveLogResult,
  ArchiveResult,
  LogQueryOptions,
  AUDIT_LOGGER_DEFAULTS,
  createDefaultAuditLoggerConfig,
  isValidAuditEntry,
  serializeAuditEntry,
  deserializeAuditEntry,
  logWriteFailedError,
  logReadFailedError,
  fallbackFailedError,
  archiveFailedError,
  queryFailedError,
  logCorruptedError,
  maxRetriesExceededError,
  AuditErrorCode,
} from './audit-logger';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensures a directory exists, creating it if necessary.
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore EEXIST errors
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Checks if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Appends a line to a file with proper newline handling.
 */
async function appendLine(filePath: string, line: string): Promise<void> {
  const lineWithNewline = line.endsWith('\n') ? line : line + '\n';
  await fs.appendFile(filePath, lineWithNewline, 'utf-8');
}

/**
 * Reads a file and returns lines as an array.
 */
async function readLines(filePath: string): Promise<string[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  return content.split('\n').filter(line => line.trim().length > 0);
}

// =============================================================================
// FileAuditLogger Implementation
// =============================================================================

/**
 * File-based implementation of AuditLogger.
 * Writes audit entries to JSONL files with retry and fallback mechanisms.
 * 
 * Requirements: R16.1, R16.2, R16.3, R16.4, R16.5
 */
export class FileAuditLogger implements AuditLogger {
  private readonly config: Required<AuditLoggerConfig>;
  private readonly primaryLogPath: string;
  private readonly fallbackLogPath: string;

  constructor(config: AuditLoggerConfig) {
    // Merge with defaults
    const defaults = createDefaultAuditLoggerConfig(config.logDirectory);
    this.config = {
      logDirectory: config.logDirectory,
      primaryLogFile: config.primaryLogFile ?? defaults.primaryLogFile!,
      fallbackLogFile: config.fallbackLogFile ?? defaults.fallbackLogFile!,
      maxRetries: config.maxRetries ?? defaults.maxRetries!,
      baseRetryDelayMs: config.baseRetryDelayMs ?? defaults.baseRetryDelayMs!,
      maxQueryResults: config.maxQueryResults ?? defaults.maxQueryResults!,
      includeFallbackInQueries: config.includeFallbackInQueries ?? defaults.includeFallbackInQueries!,
    };

    this.primaryLogPath = path.join(this.config.logDirectory, this.config.primaryLogFile);
    this.fallbackLogPath = path.join(this.config.logDirectory, this.config.fallbackLogFile);
  }

  // =========================================================================
  // Log Operations
  // =========================================================================

  /**
   * Logs an action with retry and fallback mechanisms.
   * 
   * Requirements: R16.1, R16.2, R16.3
   */
  async log(entry: AuditEntry): Promise<LogResult> {
    // Validate entry structure
    if (!isValidAuditEntry(entry)) {
      return err({
        code: AuditErrorCode.INVALID_ENTRY_FORMAT,
        category: 'AUDIT_ERROR',
        message: 'Invalid audit entry: missing required fields',
        recoverable: false,
        timestamp: new Date().toISOString(),
      });
    }

    // Serialize entry to JSONL format
    const serialized = serializeAuditEntry(entry);

    // Try to write to primary log with retries
    const primaryResult = await this.writeWithRetry(this.primaryLogPath, serialized);
    
    if (primaryResult.success) {
      return ok(undefined);
    }

    // Primary failed after retries, try fallback
    const fallbackResult = await this.writeToFallback(serialized);
    
    if (fallbackResult.success) {
      // Success via fallback - not blocking the operation
      return ok(undefined);
    }

    // Both primary and fallback failed
    return err(fallbackFailedError(
      this.primaryLogPath,
      this.fallbackLogPath,
      `Primary error: ${primaryResult.error.message}, Fallback error: ${fallbackResult.error.message}`
    ));
  }

  /**
   * Writes to log file with retry mechanism.
   * Requirements: R16.3
   */
  private async writeWithRetry(
    logPath: string,
    content: string
  ): Promise<Result<void, AuditError>> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        // Ensure directory exists
        await ensureDirectory(path.dirname(logPath));
        
        // Append to log file
        await appendLine(logPath, content);
        
        return ok(undefined);
      } catch (error) {
        lastError = error as Error;
        
        // If not the last attempt, wait before retrying
        if (attempt < this.config.maxRetries) {
          const delay = this.config.baseRetryDelayMs * Math.pow(2, attempt);
          await sleep(delay);
        }
      }
    }

    return err(logWriteFailedError(
      logPath,
      lastError?.message,
      this.config.maxRetries
    ));
  }

  /**
   * Writes to fallback log.
   * Requirements: R16.3
   */
  private async writeToFallback(content: string): Promise<Result<void, AuditError>> {
    try {
      await ensureDirectory(path.dirname(this.fallbackLogPath));
      await appendLine(this.fallbackLogPath, content);
      return ok(undefined);
    } catch (error) {
      return err(logWriteFailedError(
        this.fallbackLogPath,
        (error as Error).message
      ));
    }
  }

  // =========================================================================
  // Query Operations
  // =========================================================================

  /**
   * Gets logs for a specific resource.
   * 
   * Requirements: R16.4
   */
  async getLogsForResource(
    resourceType: string,
    resourceId: string,
    options?: LogQueryOptions
  ): Promise<QueryResult> {
    try {
      const entries = await this.readAllEntries();
      
      // Filter by resource type and ID
      let filtered = entries.filter(
        entry => entry.resource_type === resourceType && entry.resource_id === resourceId
      );
      
      // Apply additional filters
      filtered = this.applyFilters(filtered, options);
      
      // Apply sorting
      filtered = this.applySorting(filtered, options?.sortOrder);
      
      // Apply pagination
      filtered = this.applyPagination(filtered, options?.limit, options?.offset);
      
      return ok(filtered);
    } catch (error) {
      if ((error as AuditError).category === 'AUDIT_ERROR') {
        return err(error as AuditError);
      }
      return err(queryFailedError((error as Error).message));
    }
  }

  /**
   * Gets logs by correlation ID.
   * 
   * Requirements: R16.4
   */
  async getLogsByCorrelation(correlationId: string): Promise<QueryResult> {
    try {
      const entries = await this.readAllEntries();
      
      // Filter by correlation ID
      const filtered = entries.filter(
        entry => entry.correlation_id === correlationId
      );
      
      // Sort chronologically
      const sorted = this.applySorting(filtered, 'asc');
      
      return ok(sorted);
    } catch (error) {
      if ((error as AuditError).category === 'AUDIT_ERROR') {
        return err(error as AuditError);
      }
      return err(queryFailedError((error as Error).message));
    }
  }

  /**
   * Reads all entries from primary and optionally fallback logs.
   */
  private async readAllEntries(): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    const corruptedLines: { path: string; line: number; content: string }[] = [];
    
    // Read primary log
    if (await fileExists(this.primaryLogPath)) {
      const primaryLines = await readLines(this.primaryLogPath);
      for (let i = 0; i < primaryLines.length; i++) {
        try {
          const entry = deserializeAuditEntry(primaryLines[i]);
          entries.push(entry);
        } catch {
          corruptedLines.push({
            path: this.primaryLogPath,
            line: i + 1,
            content: primaryLines[i].substring(0, 100),
          });
        }
      }
    }
    
    // Read fallback log if configured
    if (this.config.includeFallbackInQueries && await fileExists(this.fallbackLogPath)) {
      const fallbackLines = await readLines(this.fallbackLogPath);
      for (let i = 0; i < fallbackLines.length; i++) {
        try {
          const entry = deserializeAuditEntry(fallbackLines[i]);
          entries.push(entry);
        } catch {
          corruptedLines.push({
            path: this.fallbackLogPath,
            line: i + 1,
            content: fallbackLines[i].substring(0, 100),
          });
        }
      }
    }
    
    // Note: We don't fail on corrupted lines, we skip them and continue
    // This allows partial reads of corrupted logs
    
    return entries;
  }

  /**
   * Applies query filters to entries.
   */
  private applyFilters(entries: AuditEntry[], options?: LogQueryOptions): AuditEntry[] {
    if (!options) return entries;
    
    let filtered = entries;
    
    // Filter by date range
    if (options.startDate) {
      const startTime = options.startDate.getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= startTime);
    }
    
    if (options.endDate) {
      const endTime = options.endDate.getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= endTime);
    }
    
    // Filter by actions
    if (options.actions && options.actions.length > 0) {
      const actionSet = new Set(options.actions);
      filtered = filtered.filter(e => actionSet.has(e.action));
    }
    
    // Filter by outcome
    if (options.outcome) {
      filtered = filtered.filter(e => e.outcome === options.outcome);
    }
    
    // Filter by actor
    if (options.actorId) {
      filtered = filtered.filter(e => e.actor_id === options.actorId);
    }
    
    if (options.actorType) {
      filtered = filtered.filter(e => e.actor_type === options.actorType);
    }
    
    return filtered;
  }

  /**
   * Applies sorting to entries.
   */
  private applySorting(
    entries: AuditEntry[],
    sortOrder: 'asc' | 'desc' = 'asc'
  ): AuditEntry[] {
    return [...entries].sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });
  }

  /**
   * Applies pagination to entries.
   */
  private applyPagination(
    entries: AuditEntry[],
    limit?: number,
    offset?: number
  ): AuditEntry[] {
    const effectiveLimit = Math.min(
      limit ?? this.config.maxQueryResults,
      this.config.maxQueryResults
    );
    const effectiveOffset = offset ?? 0;
    
    return entries.slice(effectiveOffset, effectiveOffset + effectiveLimit);
  }

  // =========================================================================
  // Maintenance Operations
  // =========================================================================

  /**
   * Archives logs older than the specified date.
   * 
   * Requirements: R16.5
   */
  async archiveLogs(before: Date): Promise<ArchiveLogResult> {
    try {
      const beforeTime = before.getTime();
      
      // Read all entries from primary log
      if (!await fileExists(this.primaryLogPath)) {
        return ok({
          archived: 0,
          archivedAt: new Date().toISOString(),
        });
      }
      
      const lines = await readLines(this.primaryLogPath);
      const entriesToKeep: string[] = [];
      const entriesToArchive: string[] = [];
      
      for (const line of lines) {
        try {
          const entry = deserializeAuditEntry(line);
          const entryTime = new Date(entry.timestamp).getTime();
          
          if (entryTime < beforeTime) {
            entriesToArchive.push(line);
          } else {
            entriesToKeep.push(line);
          }
        } catch {
          // Keep corrupted lines to avoid data loss
          entriesToKeep.push(line);
        }
      }
      
      if (entriesToArchive.length === 0) {
        return ok({
          archived: 0,
          archivedAt: new Date().toISOString(),
        });
      }
      
      // Create archive file with timestamp
      const archiveFileName = `audit-archive-${before.toISOString().split('T')[0]}.log`;
      const archivePath = path.join(this.config.logDirectory, archiveFileName);
      
      // Ensure directory exists
      await ensureDirectory(this.config.logDirectory);
      
      // Write archived entries to archive file
      await fs.writeFile(
        archivePath,
        entriesToArchive.join('\n') + '\n',
        'utf-8'
      );
      
      // Rewrite primary log with remaining entries
      if (entriesToKeep.length > 0) {
        await fs.writeFile(
          this.primaryLogPath,
          entriesToKeep.join('\n') + '\n',
          'utf-8'
        );
      } else {
        // If no entries to keep, create empty file
        await fs.writeFile(this.primaryLogPath, '', 'utf-8');
      }
      
      return ok({
        archived: entriesToArchive.length,
        archivePath,
        archivedAt: new Date().toISOString(),
      });
    } catch (error) {
      return err(archiveFailedError((error as Error).message));
    }
  }

  // =========================================================================
  // Utility Methods
  // =========================================================================

  /**
   * Gets the path to the primary log file.
   */
  getPrimaryLogPath(): string {
    return this.primaryLogPath;
  }

  /**
   * Gets the path to the fallback log file.
   */
  getFallbackLogPath(): string {
    return this.fallbackLogPath;
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): Required<AuditLoggerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new FileAuditLogger instance with the given configuration.
 */
export function createAuditLogger(config: AuditLoggerConfig): AuditLogger {
  return new FileAuditLogger(config);
}

/**
 * Creates a new FileAuditLogger with default configuration for a workspace.
 */
export function createDefaultAuditLogger(workspaceRoot: string): AuditLogger {
  return new FileAuditLogger({
    logDirectory: path.join(workspaceRoot, AUDIT_LOGGER_DEFAULTS.LOG_DIRECTORY),
  });
}
