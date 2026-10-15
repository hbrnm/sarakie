'use strict';

/**
 * Normalized domain types produced by provider adapters. Domain code depends only on
 * these shapes, never on provider responses (CLAUDE.md §4.4). All timestamps: UTC ISO-8601.
 *
 * @typedef {'SCHEDULED'|'LIVE'|'FINISHED'|'POSTPONED'|'CANCELLED'|'AWARDED'} FixtureStatus
 *
 * @typedef {object} TeamRef
 * @property {string|null} providerTeamId
 * @property {string} name
 * @property {string|null} [shortName]
 * @property {string|null} [tla]
 *
 * @typedef {object} Fixture
 * @property {string} sourceProvider
 * @property {string} providerFixtureId
 * @property {string} competitionCode
 * @property {number} season              Start year of the season.
 * @property {string} kickoffUtc
 * @property {FixtureStatus} status
 * @property {TeamRef} home
 * @property {TeamRef} away
 * @property {number|null} homeGoals      Full time, regular time only (no extra time).
 * @property {number|null} awayGoals
 * @property {number|null} [matchday]
 * @property {string|null} [stage]
 *
 * @typedef {object} OddsQuote
 * @property {string} sourceProvider
 * @property {string} providerEventId
 * @property {string} competitionCode
 * @property {string} kickoffUtc
 * @property {string} homeTeamName
 * @property {string} awayTeamName
 * @property {string} bookmakerKey
 * @property {string} bookmakerName
 * @property {string} marketCode
 * @property {string} selectionCode
 * @property {number|null} line
 * @property {number} decimalOdds
 * @property {string|null} sourceTimestamp
 * @property {string} capturedAt
 * @property {'pre_match'|'closing'} kind
 *
 * @typedef {object} NormalizationReport
 * @property {number} received
 * @property {number} accepted
 * @property {Record<string, number>} dropped   Reason code → count.
 */

module.exports = {};
