'use strict';

const _ = require('lodash');
const path = require('path');
const {Storage} = require('@google-cloud/storage');
const slugify = require('slugify');

/**
 * Check validity of Service Account configuration
 * @param config
 * @returns {{private_key}|{client_email}|{project_id}|any}
 */
const checkServiceAccount = (config) => {
    if (!config.serviceAccount) {
        throw new Error(
            '"Service Account JSON" is required!'
        );
    }
    if (!config.bucketName) {
        throw new Error(
            '"Multi-Regional Bucket name" is required!'
        );
    }
    try {
        const serviceAccount = JSON.parse(config.serviceAccount);
        /**
         * Check exist
         */
        if (!serviceAccount.project_id) {
            throw new Error(
                'Error parsing data "Service Account JSON". Missing "project_id" field in JSON file.'
            );
        }
        if (!serviceAccount.client_email) {
            throw new Error(
                'Error parsing data "Service Account JSON". Missing "client_email" field in JSON file.'
            );
        }
        if (!serviceAccount.private_key) {
            throw new Error(
                'Error parsing data "Service Account JSON". Missing "private_key" field in JSON file.'
            );
        }
        return serviceAccount;
    } catch (e) {
        throw new Error(
            'Error parsing data "Service Account JSON", please be sure to copy/paste the full JSON file.'
        );
    }
};

/**
 * Check bucket exist, or create it
 * @param GCS
 * @param bucketName
 * @param bucketLocation
 * @returns {Promise<void>}
 */
const checkBucket = async (GCS, bucketName, bucketLocation) => {
    let bucket = GCS.bucket(bucketName);
    await bucket.exists().then((data) => {
        if (!data[0]) {
            try {
                GCS.createBucket(bucketName, {
                    location: bucketLocation,
                    storageClass: 'multi_regional'
                }).then((data) => {
                    strapi.log.debug(`Bucket ${bucketName} successfully created.`);
                });
            } catch (e) {
                throw new Error(
                    'An error occurs when we try to create the Bucket "' + bucketName + '". Please try again on Google Cloud Platform directly.'
                )
            }
        }
    });
};

/**
 *
 * @type {{init: (function(*=): {upload: (function(*): Promise<any>)}), checkServiceAccount: module.exports.checkServiceAccount, provider: string, auth: {bucketName: {label: string, type: string}, bucketLocation: {values: string[], label: string, type: string}, serviceAccount: {label: string, type: string}}, checkBucket: module.exports.checkBucket, name: string}}
 */
module.exports = {
    provider: 'google-cloud-storage',
    name: 'Google Cloud Storage',
    auth: {
        serviceAccount: {
            label: 'Service Account JSON',
            type: 'textarea'
        },
        bucketName: {
            label: 'Multi-Regional Bucket Name',
            type: 'text'
        },
        bucketLocation: {
            label: 'Multi-Regional location',
            type: 'enum',
            values: [
                'asia',
                'eu',
                'us'
            ]
        }
    },
    init: (config) => {
        const serviceAccount = checkServiceAccount(config);
        const GCS = new Storage({
            projectId: serviceAccount.project_id,
            credentials: {
                client_email: serviceAccount.client_email,
                private_key: serviceAccount.private_key
            }
        });

        return {
            upload: (file) => {
                return new Promise((resolve, reject) => {
                    const filePath = file.path ? `${file.path}/` : `${file.hash}/`;
                    const fileName = slugify(path.basename(file.name, file.ext)) + file.ext.toLowerCase();

                    checkBucket(GCS, config.bucketName, config.bucketLocation).then(() => {
                        GCS
                        .bucket(config.bucketName)
                        .file(`${filePath}${fileName}`)
                        .save(file.buffer, {
                                contentType: file.mime,
                                public: true,
                                metadata: {
                                    contentDisposition: `inline; filename="${file.name}"`
                                }
                            }
                        )
                        .then(()=>{
                            file.url = `https://storage.googleapis.com/${config.bucketName}/${filePath}${fileName}`;
                            strapi.log.debug(`File successfully uploaded to ${file.url}`);
                            resolve();
                        })
                        .catch(error => {
                            return reject(error);
                        });

                        
                    });
                });
            },
            delete: (file) => {
                return new Promise((resolve, reject) => {
                    const filePath = file.path ? `${file.path}/` : `${file.hash}/`;
                    const fileName = slugify(path.basename(file.name, file.ext)) + file.ext.toLowerCase();
                    
                    GCS
                    .bucket(config.bucketName)
                    .file(`${filePath}${fileName}`)
                    .delete()
                    .catch(error => {
                        if (error.code === 404) {
                            return strapi.log.warn(
                                'Remote file was not found, you may have to delete manually.'
                            );
                        }
                        reject(error);
                    });

                    strapi.log.debug(`File ${file.url} successfully deleted`);
                    resolve();
                })
            }
        }
    }
};