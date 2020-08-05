/**
 * Copyright 2013-2020 the original author or authors from the JHipster project.
 *
 * This file is part of the JHipster project, see https://www.jhipster.tech/
 * for more information.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const chalk = require('chalk');
const fs = require('fs');
const _ = require('lodash');
const path = require('path');
const pretty = require('js-object-pretty-print').pretty;
const pluralize = require('pluralize');
const { fork } = require('child_process');

const { CLI_NAME, GENERATOR_NAME, logger, toString, printSuccess, doneFactory, getOptionAsArgs } = require('./utils');
const { getDBTypeFromDBValue, loadYoRc } = require('../generators/utils');
const { createImporterFromContent, createImporterFromFiles } = require('../jdl/jdl-importer');

const packagejs = require('../package.json');
const statistics = require('../generators/statistics');
const { JHIPSTER_CONFIG_DIR, SUPPORTED_CLIENT_FRAMEWORKS } = require('../generators/generator-constants');

const runYeomanProcess = require.resolve('./run-yeoman-process.js');
const { writeConfigFile } = require('../jdl/exporters/export-utils');
const { createFolderIfItDoesNotExist } = require('../jdl/utils/file-utils');

const ANGULAR = SUPPORTED_CLIENT_FRAMEWORKS.ANGULAR;

const getDeploymentType = deployment => deployment && deployment[GENERATOR_NAME] && deployment[GENERATOR_NAME].deploymentType;

function writeEntityConfig(entity, basePath) {
    const entitiesPath = path.join(basePath, JHIPSTER_CONFIG_DIR);
    createFolderIfItDoesNotExist(entitiesPath);
    const filePath = path.join(entitiesPath, `${_.upperFirst(entity.name)}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entity, null, 2).concat('\n'));
}

function writeApplicationConfig(applicationWithEntities, basePath) {
    createFolderIfItDoesNotExist(basePath);
    writeConfigFile({ 'generator-jhipster': applicationWithEntities.config }, path.join(basePath, '.yo-rc.json'));
    applicationWithEntities.entities.forEach(entity => writeEntityConfig(entity, basePath));
}

function runGenerator(command, cwd, generatorOptions = {}) {
    generatorOptions = { ...generatorOptions, fromCli: true };
    logger.debug(`Child process will be triggered for ${command} with cwd: ${cwd}`);
    const args = [command, ...getOptionAsArgs(generatorOptions)];
    const childProc = fork(runYeomanProcess, args, {
        cwd,
    });
    return new Promise(resolve => {
        childProc.on('exit', code => {
            if (code !== 0) {
                process.exitCode = code;
            }
            logger.debug(`Process ${args} exited with code ${code}`);
            logger.info(`Generator ${command} child process exited with code ${code}`);
            resolve();
        });
    });
}

/**
 * Imports the Applications and Entities defined in JDL
 * The app .yo-rc.json files and entity json files are written to disk
 */
function importJDL(jdlImporter) {
    logger.info('The JDL is being parsed.');

    try {
        const importState = jdlImporter.import();
        logger.debug(`importState exportedEntities: ${importState.exportedEntities.length}`);
        logger.debug(`importState exportedApplications: ${importState.exportedApplications.length}`);
        logger.debug(`importState exportedDeployments: ${importState.exportedDeployments.length}`);
        if (importState.exportedEntities.length > 0) {
            const entityNames = _.uniq(importState.exportedEntities.map(exportedEntity => exportedEntity.name)).join(', ');
            logger.info(`Found entities: ${chalk.yellow(entityNames)}.`);
        } else {
            logger.info(chalk.yellow('No change in entity configurations, no entities were updated.'));
        }
        logger.info('The JDL has been successfully parsed');
        return importState;
    } catch (error) {
        logger.debug('Error:', error);
        if (error) {
            const errorName = `${error.name}:` || '';
            const errorMessage = error.message || '';
            logger.log(chalk.red(`${errorName} ${errorMessage}`));
        }
        logger.error(`Error while parsing applications and entities from the JDL ${error}`, error);
        throw error;
    }
}

/**
 * Check if application needs to be generated
 * @param {any} processor
 */
const shouldGenerateApplications = processor =>
    !processor.options.ignoreApplication && processor.importState.exportedApplications.length !== 0;

/**
 * Check if deployments needs to be generated
 * @param {any} processor
 */
const shouldGenerateDeployments = processor =>
    !processor.options.ignoreDeployments && processor.importState.exportedDeployments.length !== 0;

/**
 * Generate deployment source code for JDL deployments defined.
 * @param {any} config
 * @returns Promise
 */
const generateDeploymentFiles = ({ processor, deployment, inFolder }) => {
    const deploymentType = getDeploymentType(deployment);
    logger.info(`Generating deployment ${deploymentType} in a new parallel process`);
    logger.debug(`Generating deployment: ${pretty(deployment[GENERATOR_NAME])}`);

    const cwd = inFolder ? path.join(processor.pwd, deploymentType) : processor.pwd;
    logger.debug(`Child process will be triggered for ${runYeomanProcess} with cwd: ${cwd}`);

    const command = `${CLI_NAME}:${deploymentType}`;
    const force = !processor.options.interactive ? true : undefined;
    return runGenerator(command, cwd, { force, ...processor.options, skipPrompts: true });
};

/**
 * Generate application source code for JDL apps defined.
 * @param {any} config
 * @returns Promise
 */
const generateApplicationFiles = ({ processor, applicationWithEntities, inFolder }) => {
    const baseName = applicationWithEntities.config.baseName;
    logger.debug(`Generating application: ${pretty(applicationWithEntities.config)}`);

    const cwd = inFolder ? path.join(processor.pwd, baseName) : processor.pwd;
    writeApplicationConfig(applicationWithEntities, cwd);

    if (!shouldGenerateApplications(processor)) {
        logger.debug('Applications not generated');
        return Promise.resolve();
    }

    const command = `${CLI_NAME}:app`;
    const force = !processor.options.interactive ? true : undefined;
    const withEntities = applicationWithEntities.entities.length > 0 ? true : undefined;
    return runGenerator(command, cwd, { force, withEntities, ...processor.options });
};

/**
 * Generate entities for the applications
 * @param {any} processor
 * @param {any} entity
 * @param {boolean} inFolder
 * @param {any} env
 * @param {boolean} shouldTriggerInstall
 * @return Promise
 */
const generateEntityFiles = (processor, entity, inFolder, env, shouldTriggerInstall) => {
    const options = {
        skipInstall: !shouldTriggerInstall,
        force: !processor.options.interactive ? true : undefined,
        ...processor.options,
        regenerate: true,
        fromCli: true,
    };
    const command = `${CLI_NAME}:entity ${entity.name}`;
    if (inFolder) {
        /* Generating entities inside multiple apps */
        const callGenerator = baseName => {
            logger.info(`Generating entity ${entity.name} for application ${baseName} in a new parallel process`);
            const cwd = path.join(processor.pwd, baseName);
            writeEntityConfig(entity, cwd);

            if (processor.options.jsonOnly) {
                logger.info('Entity JSON files created. Entity generation skipped.');
                return Promise.resolve();
            }

            logger.debug(`Child process will be triggered for ${runYeomanProcess} with cwd: ${cwd}`);
            return runGenerator(command, cwd, options);
        };
        const baseNames = entity.applications;
        if (processor.options.interactive) {
            return baseNames.reduce((promise, baseName) => {
                return promise.then(() => callGenerator(baseName));
            }, Promise.resolve());
        }
        return Promise.all(baseNames.map(callGenerator));
    }

    writeEntityConfig(entity, processor.pwd);

    if (processor.options.jsonOnly) {
        logger.info('Entity JSON files created. Entity generation skipped.');
        return Promise.resolve();
    }

    /* Traditional entity only generation */
    return env.run(command, options).catch(doneFactory());
};

/**
 * Check if NPM install needs to be triggered. This will be done for the last entity.
 * @param {any} processor
 * @param {number} index
 */
const shouldTriggerInstall = (processor, index) =>
    index === processor.importState.exportedEntities.length - 1 &&
    !processor.options.skipInstall &&
    !processor.skipClient &&
    !processor.options.jsonOnly &&
    !shouldGenerateApplications(processor);

class JDLProcessor {
    constructor(jdlFiles, jdlContent, options) {
        logger.debug(
            `JDLProcessor started with ${jdlContent ? `content: ${jdlContent}` : `files: ${jdlFiles}`} and options: ${toString(options)}`
        );
        this.jdlFiles = jdlFiles;
        this.jdlContent = jdlContent;
        this.options = options;
        this.pwd = process.cwd();
    }

    getConfig() {
        if (fs.existsSync('.yo-rc.json')) {
            const yoRC = loadYoRc('.yo-rc.json');
            const configuration = yoRC['generator-jhipster'];
            if (!configuration) {
                return;
            }
            logger.info('Found .yo-rc.json on path. This is an existing app');
            if (this.options.interactive === undefined) {
                logger.debug('Setting interactive true for existing apps');
                this.options.interactive = true;
            }
            this.applicationType = configuration.applicationType;
            this.baseName = configuration.baseName;
            this.databaseType = configuration.databaseType || getDBTypeFromDBValue(this.options.db);
            this.prodDatabaseType = configuration.prodDatabaseType || this.options.db;
            this.devDatabaseType = configuration.devDatabaseType || this.options.db;
            this.skipClient = configuration.skipClient;
            this.clientFramework = configuration.clientFramework;
            this.clientFramework = this.clientFramework || ANGULAR;
            this.clientPackageManager = configuration.clientPackageManager || 'npm';
        }
    }

    importJDL() {
        const configuration = {
            databaseType: this.prodDatabaseType,
            applicationType: this.applicationType,
            applicationName: this.baseName,
            generatorVersion: packagejs.version,
            forceNoFiltering: this.options.force,
            creationTimestamp: this.options.creationTimestamp,
            skipFileGeneration: true,
        };

        let importer;
        if (this.jdlContent) {
            importer = createImporterFromContent(this.jdlContent, configuration);
        } else {
            importer = createImporterFromFiles(this.jdlFiles, configuration);
        }
        this.importState = importJDL.call(this, importer);
    }

    sendInsight() {
        statistics.sendSubGenEvent('generator', 'import-jdl');
    }

    generateApplications() {
        const applicationsWithEntities = Object.values(this.importState.exportedApplicationsWithEntities);
        logger.info(`Generating ${applicationsWithEntities.length} ${pluralize('application', applicationsWithEntities.length)}.`);
        const callGenerator = applicationWithEntities => {
            try {
                return generateApplicationFiles({
                    processor: this,
                    applicationWithEntities,
                    inFolder: applicationsWithEntities.length > 1,
                });
            } catch (error) {
                logger.error(`Error while generating applications from the parsed JDL\n${error}`, error);
                throw error;
            }
        };
        if (this.options.interactive) {
            return applicationsWithEntities.reduce((promise, applicationWithEntities) => {
                return promise.then(() => callGenerator(applicationWithEntities));
            }, Promise.resolve());
        }
        return Promise.all(applicationsWithEntities.map(callGenerator));
    }

    generateDeployments() {
        if (!shouldGenerateDeployments(this)) {
            logger.debug('Deployments not generated');
            return Promise.resolve();
        }
        logger.info(
            `Generating ${this.importState.exportedDeployments.length} ` +
                `${pluralize('deployment', this.importState.exportedDeployments.length)}.`
        );

        const callDeploymentGenerator = () => {
            const callGenerator = deployment => {
                try {
                    return generateDeploymentFiles({
                        processor: this,
                        deployment,
                        inFolder: true,
                    });
                } catch (error) {
                    logger.error(`Error while generating deployments from the parsed JDL\n${error}`, error);
                    throw error;
                }
            };
            if (this.options.interactive) {
                // Queue callGenerator in chain
                return this.importState.exportedDeployments.reduce((promise, deployment) => {
                    return promise.then(() => callGenerator(deployment));
                }, Promise.resolve());
            }
            return Promise.all(this.importState.exportedDeployments.map(callGenerator));
        };

        return callDeploymentGenerator();
    }

    generateEntities(env) {
        if (this.importState.exportedEntities.length === 0 || shouldGenerateApplications(this)) {
            logger.debug('Entities not generated');
            return Promise.resolve();
        }
        try {
            logger.info(
                `Generating ${this.importState.exportedEntities.length} ` +
                    `${pluralize('entity', this.importState.exportedEntities.length)}.`
            );
            return Promise.all(
                this.importState.exportedEntities.map((exportedEntity, i) => {
                    return generateEntityFiles(
                        this,
                        exportedEntity,
                        this.importState.exportedApplications.length > 1,
                        env,
                        shouldTriggerInstall(this, i)
                    );
                })
            );
        } catch (error) {
            logger.error(`Error while generating entities from the parsed JDL\n${error}`, error);
            throw error;
        }
    }
}

/**
 * Import-JDL sub generator
 * @param {any} args arguments passed for import-jdl
 * @param {any} options options passed from CLI
 * @param {any} env the yeoman environment
 */
module.exports = (jdlFiles, options = {}, env) => {
    logger.info(chalk.yellow(`Executing import-jdl ${options.inline ? 'with inline content' : jdlFiles.join(' ')}`));
    logger.debug(chalk.yellow(`Options: ${toString({ ...options, inline: options.inline ? 'inline content' : '' })}`));
    try {
        const jdlImporter = new JDLProcessor(jdlFiles, options.inline, options);
        jdlImporter.getConfig();
        jdlImporter.importJDL();
        jdlImporter.sendInsight();
        return jdlImporter
            .generateApplications()
            .then(() => {
                return jdlImporter.generateEntities(env);
            })
            .then(() => {
                return jdlImporter.generateDeployments();
            })
            .then(() => {
                printSuccess();
                return jdlFiles;
            });
    } catch (e) {
        logger.error(`Error during import-jdl: ${e.message}`, e);
        return Promise.reject(new Error(`Error during import-jdl: ${e.message}`));
    }
};
