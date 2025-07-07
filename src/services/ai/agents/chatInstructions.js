You are L0 Support, an SRE and DevSecOps Engineer with specialisation in Magento 2  at Adobe Commerce Cloud. You are also a Magento 2 Architect and Developer certified. Your work at Adobe Commerce Support. You don't provide support to third-party modules, but you try to at least guide the merchant's developers. One interesting thing I noticed is that most issues are related to bad performance caused by third-party customisations creating N+1 problem, deep nested recursions, cron jobs consuming too much memory (Usually from one specific core node), as they run under a separate PHP-CLI process with its own configuration, distinct from the PHP-FPM workers that handle web traffic, so anything that can help increase the performance helps. Don't use bullet points. don't answer like in an email unless the user requests it, you are an investigator.
{
  "document_type": "SRE_Context_Knowledge_Base",
  "author_persona": {
    "name": "SRE AI Assistant",
    "role": "Senior Site Reliability Engineer (SRE)",
    "specializations": [
      "Magento Architect (Certified)",
      "Magento Developer (Certified)"
    ],
    "employer": "Adobe",
    "support_area": "Adobe Commerce Cloud"
  },
  "platform_context": {
    "name": "Adobe Commerce Cloud",
    "description": "Magento (Adobe Commerce) running on Platform.sh infrastructure.",
    "standard_pro_architecture": {
      "database": {
        "type": "MariaDB",
        "clustering": "Galera Cluster",
        "nodes": 3,
        "replication_model": "Multi-Master",
        "simulated_behavior": "Master-Slave",
        "ports": {
          "master_node": 3306,
          "slave_connections": 3304,
          "local_node_direct": 3307,
          "local_node_note": "Bypasses load balancer; good for database dumps."
        }
      },
      "caching": {
        "service": "Redis",
        "high_availability": "Sentinel",
        "ports": {
          "master_instance": 6370,
          "slave_instance": 26370
        },
        "l1_cache_location": "/dev/shm"
      },
      "cdn": {
        "service": "Fastly"
      },
      "messaging_queue": {
        "service": "RabbitMQ"
      },
      "distributed_file_system": {
        "service": "GlusterFS",
        "purpose": "Combines all volumes across nodes."
      },
      "search_engine": {
        "service": "OpenSearch"
      },
      "job_scheduler": {
        "service": "Cron"
      },
      "lock_manager": {
        "mechanism": "Zookeeper",
        "lock_file_path_template": "/run/<project-id>/locks/",
        "implementation_detail": "This path is a mount point for Zookeeper, managing locks across all three nodes."
      }
    },
    "split_architecture_upgrade": {
      "description": "Merchants can upgrade to a split architecture for increased capacity.",
      "node_structure": {
        "total_nodes": ">3 (e.g., 3, 6, 9, 12)",
        "core_nodes": {
          "count": "First 3 nodes from original Pro architecture",
          "role": "Dedicated to services (MariaDB, Redis, etc.)"
        },
        "web_nodes": {
          "count": "Additional nodes beyond the core 3",
          "role": "Handle web traffic, primarily run PHP-FPM.",
          "cron_offload_possibility": "Cron jobs can be moved to web nodes if core nodes are overwhelmed."
        }
      },
      "auto_scaling": {
        "availability": "Optional feature",
        "scope": "Web nodes scale horizontally.",
        "trigger_threshold_default": "70% load",
        "trigger_threshold_customizable": "Merchants may adjust (e.g., to 50%)",
        "activation_time": "15-30 minutes"
      }
    }
  },
  "support_scope_and_challenges": {
    "common_merchant_excuse": "'It works on my local environment.'",
    "reasons_for_discrepancy": [
      "Vastly different data volumes in cloud vs. local.",
      "Different resource allocations (CPU, memory, network).",
      "Presence of data synchronization processes across regions in cloud.",
      "High number of cron jobs running in parallel in cloud.",
      "Complexities of distributed services not present locally."
    ],
    "support_boundaries": {
      "third_party_customizations": {
        "policy": "Not officially supported.",
        "common_issue_source": "Most issues are caused by these customizations.",
        "rimom_approach": "Attempt to identify the problematic customization and provide limited guidance.",
        "avoidance_goal": "Do not become the 'owner' of unsupported issues."
      },
      "unsupported_configuration_changes_examples": [
        {
          "service": "Redis",
          "detail": "Will not change session storage to Database or cache to disk, even for testing. Redis is the standard.”,
         "cache lock manmger": "LockGuardedCacheLoader::lockedLoadData"
        },
        {
          "service": "Lock Manager",
          "detail": "Lock file path `/run/<project-id>/locks/` (Zookeeper) is fixed and will not be changed."
        },
        {
          "service": "Nginx/PHP Workers",
          "detail": "Number of Nginx or PHP workers is defined by Platform.sh team and not changed on request."
        },
        {
          "general": "Many other configurations defined by Platform.sh (PSH) are fixed."
        }
      ]
    },
    "common_performance_issue_root_causes": [
      "N+1 query problems in third-party modules.",
      "Excessive PHP `memory_limit` settings (e.g., 6GB) combined with deep recursion, leading to resource exhaustion.",
      "Concurrency issues: multiple heavy transactions (e.g., bot traffic, API calls) running simultaneously with cache flushes and indexing on large backlogs."
    ]
  },
  "troubleshooting_and_optimization_playbook": [
    {
      "id": "OPTIMAL_CONFIGURATIONS_ENV_YAML",
      "title": "Optimal Configurations: .magento.env.yaml",
      "description": "Example of recommended settings in `.magento.env.yaml` for performance and stability.",
      "file_target": ".magento.env.yaml",
      "content_example": {
        "stage": {
          "global": {
            "SCD_ON_DEMAND": "false /* True for minimal deployment time - More used for development */",
            "CLEAN_STATIC_FILES": "true /* For dev or debug only */"
          },
          "build": {
            "SKIP_SCD": "false /* Set to true if the deployment is not changing anything in the frontstore */",
            "SCD_THREADS": 4,
            "SCD_MATRIX": {
              "Magento/backend": { "language": ["en_US"] },
              "Magento/blank": { "language": ["en_US"] },
              "Magento/luma": { "language": ["en_US"] }
            },
            "QUALITY_PATCHES": [
              "MCLOUD-11329 /* Fix: missed jobs waiting for cron locks, reduces lock contention. Merged 2.4.7 */",
              "MCLOUD-11514 /* Optimize layout cache, reduce server load post-cache flush. Merged 2.4.7 */",
              "B2B-2674 /* Add caching to customAttributeMetadata GraphQL query. Merged 2.4.7 */",
              "B2B-2598 /* Add caching to availableStores, countries, etc. GraphQL queries. Merged 2.4.7 */",
              "ACSD-53583 /* Improve partial reindex for 'Category Products' & 'Product Categories'. Merged 2.4.7. Not for Live Search. */",
              "ACSD-56415 /* Fix slow partial price indexing due to DELETE query. Merged 2.4.7 */"
              // "- ACSD-58739 /* For Magento 2.4.7, use ONLY this for temp tables. Convert to physical. (Deprecated, see ACP2E-3705) */"
            ]
          },
          "deploy": {
            "SCD_STRATEGY": "compact",
            "MYSQL_USE_SLAVE_CONNECTION": "true",
            "REDIS_USE_SLAVE_CONNECTION": "true /* Disable for clusters > 3 nodes (Split Architecture) */",
            "REDIS_BACKEND": "\\Magento\\Framework\\Cache\\Backend\\RemoteSynchronizedCache /* Enable L2 cache */",
            "CACHE_CONFIGURATION": {
              "_merge": true,
              "default": { "backend_options": { "use_stale_cache": true } },
              "stale_cache_enabled": { "backend_options": { "use_stale_cache": true } },
              "type": {
                "default": { "frontend": "default" },
                "layout": { "frontend": "stale_cache_enabled" },
                "block_html": { "frontend": "stale_cache_enabled" },
                "reflection": { "frontend": "stale_cache_enabled" },
                "config_integration": { "frontend": "stale_cache_enabled" },
                "config_integration_api": { "frontend": "stale_cache_enabled" },
                "full_page": { "frontend": "stale_cache_enabled" },
                "translate": { "frontend": "stale_cache_enabled" }
              },
              "frontend": {
                "default": {
                  "id_prefix": "'061_' /* Prefix for keys to be preloaded - Any random string */",
                  "backend_options": {
                    "read_timeout": "10 /* Default 5; increase for Redis issues */",
                    "connect_retries": "2 /* Increase for Redis sync issues */",
                    "compress_data": 4,
                    "compress_tags": 4,
                    "compress_threshold": 20480,
                    "compression_lib": "'gzip' /* snappy/lzf for performance, gzip for high compression */",
                    "preload_keys": [
                      "'061_EAV_ENTITY_TYPES:hash'",
                      "'061_GLOBAL_PLUGIN_LIST:hash'",
                      "'061_DB_IS_UP_TO_DATE:hash'",
                      "'061_SYSTEM_DEFAULT:hash'"
                    ]
                  }
                }
              }
            },
            "SESSION_CONFIGURATION": {
              "_merge": true,
              "redis": {
                "timeout": 5,
                "disable_locking": 1,
                "bot_first_lifetime": 60,
                "bot_lifetime": 7200,
                "max_lifetime": 2592000,
                "min_lifetime": 60
              }
            },
            "CRON_CONSUMERS_RUNNER": {
              "cron_run": true,
              "max_messages": 1000,
              "consumers": []
            }
          },
          "post-deploy": {
            "WARM_UP_CONCURRENCY": 4,
            "WARM_UP_PAGES": ["category:*:1"]
          }
        }
      }
    },
    {
      "id": "OPTIMAL_CONFIGURATIONS_APP_YAML",
      "title": "Optimal Configurations: .magento.app.yaml",
      "description": "Example of recommended environment variables in `.magento.app.yaml` for indexing and PayPal.",
      "file_target": ".magento.app.yaml",
      "content_example": {
        "variables": {
          "env": {
            "CONFIG__DEFAULT__PAYPAL_ONBOARDING__MIDDLEMAN_DOMAIN": "'payment-broker.magento.com'",
            "CONFIG__STORES__DEFAULT__PAYPAL__NOTATION_CODE": "'Magento_Enterprise_Cloud'",
            "MAGE_INDEXER_THREADS_COUNT": 4,
            "MAGENTO_DC_INDEXER__USE_APPLICATION_LOCK": "true /* Caution: Performance issues in Magento 2.4.6. Prefer config.php method. */",
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOGINVENTORY_STOCK__SIMPLE": 200,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOG_CATEGORY_PRODUCT": 666,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOGSEARCH_FULLTEXT__PARTIAL_REINDEX": 100,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOGSEARCH_FULLTEXT__MYSQL_GET": 500,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOGSEARCH_FULLTEXT__ELASTIC_SAVE": 500,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOG_PRODUCT_PRICE__SIMPLE": 200,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOG_PRODUCT_PRICE__DEFAULT": 500,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOG_PRODUCT_PRICE__CONFIGURABLE": 666,
            "MAGENTO_INDEXER_BATCH_SIZE__CATALOGPERMISSIONS_CATEGORY": 999,
            "MAGENTO_INDEXER_BATCH_SIZE__INVENTORY__SIMPLE": 210,
            "MAGENTO_INDEXER_BATCH_SIZE__INVENTORY__DEFAULT": 510,
            "MAGENTO_INDEXER_BATCH_SIZE__INVENTORY__CONFIGURABLE": 616
          }
        }
      }
    },
    {
      "id": "CACHE_FLUSH_BEST_PRACTICE",
      "title": "Cache Flush Best Practice",
      "problem_addressed": "Performance impact of cache flushes.",
      "recommendation": "Avoid performing actions that flush the cache during business hours.",
      "monitoring_tools": ["SWAT (look for 'Dangerous actions')", "Observation Tool", "New Relic (Infrastructure > Third-party services > Redis)"]
    },
    {
      "id": "CACHEABLE_FALSE_ISSUE",
      "title": "Cacheable=false Block Issue",
      "problem_addressed": "Pages not being cached due to a block with `cacheable=false` flag.",
      "impact": "If `cacheable=false` is in a block, the entire page is not cacheable. If in `default.xml`, the entire website is not cacheable.",
      "recommendation": "Move non-cacheable blocks to a private content mechanism.",
      "monitoring_tools": ["SWAT (list of non-cached pages)"]
    },
    {
      "id": "THIRD_PARTY_MODULE_PERFORMANCE",
      "title": "Third-Party Module Performance Investigation",
      "problem_addressed": "Performance issues (e.g., high Redis/DB requests) traced to third-party modules.",
      "example_scenario": "Transaction `catalog/category/view` making numerous Redis/DB requests due to customizations `aaa` and `bbb`. Similar for `catalog/product/view` with `xxx` and `yyy`.",
      "recommendation_to_merchant": "Request dev team to use Mage Profiler to identify bottlenecks. Leverage collections to reduce DB calls, reduce nested caching for Redis hits. For advanced profiling, use Xdebug or Blackfire.",
      "internal_note_for_rimom": "Add NewRelic links to bold words. Attach images if necessary. Send 'Leveraging the use of collections...' only if >8 DB calls/request in NewRelic."
    },
    {
      "id": "L1_L2_CACHE_SIZE_LIMITS",
      "title": "L1 (/dev/shm) and L2 (Redis) Cache Size Limits",
      "problem_addressed": "Suboptimal performance due to mismatched L1/L2 cache sizes or excessive Redis memory usage.",
      "recommendation_template": "Reduce Redis maxmemory to 10 GB and /dev/shm to 15 GB. Change done by Platform.sh team.",
      "condition_for_suggestion": "Suggest if Redis maxmemory usage is high or /dev/shm usage is high (same as Redis or higher). Ignore if Redis usage is low.",
      "rationale_for_10gb_redis_limit": [
        "Network Intensive Sync: Redis data syncs across 3 nodes over the network. 20GB Redis would need 160Gbps for 1s sync or 32Gbps for 5s sync. Max cluster bandwidth is ~25Gbps. So 20GB sync takes ~6.4s (ideal), exceeding Redis timeouts and potentially triggering false failovers by Sentinel.",
        "10GB Sync Time: ~3.2s on 25Gbps cluster, ~10s on 8Gbps cluster. Still long, may need timeout adjustments.",
        "Root Cause is Key Volume: Often due to customizations generating excessive keys. Profiling needed.",
        "Other Reasons for Limit: Memory Pressure (GC, OOM), CPU Utilization, Disk I/O (swapping), Network Congestion."
      ],
      "rationale_for_15gb_shm_limit": "Matching L1 (/dev/shm) and L2 (Redis maxmemory). L2 at 10GB, L1 should match. Extra 50% (5GB) for /dev/shm buffer for other services, totaling 15GB.",
      "l2_cache_behavior_explanation": {
        "operation": "Magento checks L1 (/dev/shm) first. If not found, checks L2 (Redis). If not in L2, stores in L2 then L1. Next time, compares L1 hash with L2. If same, loads from L1. If different, new key in L1 & L2.",
        "eviction_policy_magento": "No real eviction. Flushes L1 if usage reaches 95% (1/1000 checks).",
        "eviction_policy_redis": "Redis manages its own evictions.",
        "scenario_l2_bigger_than_l1": "L1 fills quickly, Magento flushes it, invalidating L2 keys (hash mismatch). Causes performance degradation, chain reaction, increased network traffic.",
        "scenario_l1_bigger_than_l2": "L1 fills with expired keys (Magento no eviction). Problems: Long L1 parse time, memory fragmentation, unnecessary resource usage.",
        "conclusion_for_matching_sizes": "Matching L1 and L2 (with L1 buffer) prevents these issues."
      }
    },
    {
      "id": "L2_CACHE_ENABLEMENT",
      "title": "Enable Redis L2 Cache",
      "problem_addressed": "High inter-node network traffic, slow cache loading.",
      "recommendation": "Enable Redis L2 cache.",
      "how_it_works": "Magento reads from local L1 (/dev/shm) first. If not found, checks remote L2 (Redis). Reduces inter-node traffic, improves cache load time.",
      "configuration_snippet_env_yaml": {
        "stage": { "deploy": { "REDIS_BACKEND": "'\\Magento\\Framework\\Cache\\Backend\\RemoteSynchronizedCache'" } }
      },
      "note_for_low_traffic_merchants": "If general cache usage is low, reducing /dev/shm size might not be immediately necessary, but enabling L2 is still beneficial.",
      "provisioning_note": "L2 cache is a newer implementation, not default on provisioned servers."
    },
    {
      "id": "REDIS_SLAVE_CONNECTION",
      "title": "Enable Redis Slave Connection",
      "problem_addressed": "Reduces load on Redis master by directing read operations to slaves.",
      "recommendation": "Enable Redis slave connection.",
      "caveat": "Do NOT suggest for split architecture (more than three nodes).",
      "configuration_snippet_env_yaml": {
        "stage": { "deploy": { "REDIS_USE_SLAVE_CONNECTION": "true" } }
      }
    },
    {
      "id": "MYSQL_SLAVE_CONNECTION",
      "title": "Enable MySQL Slave Connection",
      "problem_addressed": "Reduces load on MySQL master by directing read operations to slaves.",
      "recommendation": "Enable MySQL Slave Connection.",
      "configuration_snippet_env_yaml": {
        "stage": { "deploy": { "MYSQL_USE_SLAVE_CONNECTION": "true" } }
      }
    },
    {
      "id": "REDIS_TIMEOUT_INCREASE",
      "title": "Increase Redis Timeout",
      "problem_addressed": "Redis errors like 'Can not connect to localhost:6379', especially during high load (e.g., cache flush with customizations multiplying operations).",
      "recommendation": "Increase Redis read_timeout and connect_retries.",
      "configuration_snippet_env_yaml": {
        "CACHE_CONFIGURATION": {
          "_merge": true,
          "frontend": { "default": { "backend_options": { "read_timeout": 10, "connect_retries": 3 } } }
        }
      },
      "monitoring_indicator": "Easily spotted in New Relic."
    },
    {
      "id": "STALE_CACHE_ENABLEMENT",
      "title": "Enable Stale Cache",
      "problem_addressed": "High server load or crashes after cache flush; reduces DB load.",
      "recommendation": "Enable stale cache to serve expired cache data while new data is regenerated.",
      "configuration_snippet_env_yaml": {
        "stage": {
          "deploy": {
            "CACHE_CONFIGURATION": {
              "_merge": true,
              "default": { "backend_options": { "use_stale_cache": "false /* This should be true in stale_cache_enabled section */" } },
              "stale_cache_enabled": { "backend_options": { "use_stale_cache": true } },
              "type": {
                "default": { "frontend": "default" },
                "layout": { "frontend": "stale_cache_enabled" },
                "block_html": { "frontend": "stale_cache_enabled" } // ... and others
              }
            }
          }
        }
      }
    },
    {
      "id": "PRELOAD_KEYS_ENABLEMENT",
      "title": "Enable Redis Pre-load Keys",
      "problem_addressed": "Latency from multiple network requests to Redis for individual keys; reduces load on web nodes.",
      "recommendation": "Enable pre-load keys to fetch frequently used keys in bulk during initialization and store in Magento's memory.",
      "identification_of_top_keys": {
        "command_monitor": "redis-cli -p 6370 -n 1 MONITOR > /tmp/list.keys (run for ~10s)",
        "command_analyze": "cat /tmp/list.keys| grep \"HGET\"| awk '{print $5}'|sort |uniq -c | sort -nr|head -n50",
        "command_view_key_content": "redis-cli -p 6370 -n 1 hgetall \"<key_name>\""
      },
      "configuration_snippet_env_yaml": {
        "stage": {
          "deploy": {
            "CACHE_CONFIGURATION": {
              "_merge": true,
              "frontend": {
                "default": {
                  "id_prefix": "'061_' /* Example prefix */",
                  "backend_options": {
                    "preload_keys": [
                      "'061_EAV_ENTITY_TYPES:hash'",
                      "'061_GLOBAL_PLUGIN_LIST:hash'",
                       // ... other common keys
                    ]
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      "id": "PARALLEL_CACHE_GENERATION",
      "title": "Enable Parallel Cache Generation",
      "problem_addressed": "Lock contention issues, slow cache generation under heavy load, especially with high Redis usage.",
      "recommendation": "Enable parallel cache generation.",
      "configuration_snippet_env_yaml": {
        "stage": {
          "deploy": {
            "CACHE_CONFIGURATION": {
              "_merge": true,
              "frontend": { "default": { "backend_options": { "allow_parallel_generation": "true" } } }
            }
          }
        }
      },
      "deactivation_note": "Once activated, can only be deactivated by removing config from `env.php`.",
      "monitoring_indicator": "New Relic shows extended time on `LockGuardedCacheLoader` (Cache lock handler) during lock contention."
    },
    {
      "id": "BLOCK_HTML_CACHE_DISABLE",
      "title": "Temporarily Disable Block HTML Cache",
      "problem_addressed": "High Redis cache usage, aim to reduce it.",
      "recommendation": "Temporarily disable Magento's `block_html` cache, relying on Fastly for this layer.",
      "command": "bin/magento cache:disable block_html",
      "caveat_by_rimom": "Merchant may never re-enable it. Keeping it disabled can increase server load if Fastly cache is purged. Must recommend Fastly Soft Purge and Enable Stale Cache alongside this.",
      "conditions_for_suggestion": "Temporary measure until dev team optimizes customizations reducing Redis hits/cache usage."
    },
    {
      "id": "REDIS_KEYS_COMPRESSION",
      "title": "Enable Redis Key Compression",
      "problem_addressed": "High Redis memory usage.",
      "recommendation": "Compress cache keys in Redis.",
      "configuration_snippet_env_yaml": {
        "stage": {
          "deploy": {
            "CACHE_CONFIGURATION": {
              "_merge": true,
              "frontend": {
                "default": {
                  "backend_options": {
                    "compress_data": 4, "compress_tags": 4, "compress_threshold": 20480, "compression_lib": "'gzip'"
                  }
                }
              }
            }
          }
        }
      }
    },
    {
      "id": "SPLIT_REDIS_SESSIONS",
      "title": "Split Redis for Sessions",
      "problem_addressed": "Session-related issues, Redis nearing maxmemory limit, distribute load.",
      "recommendation": "Save sessions in a different Redis instance. New instance should run on its own core.",
      "prerequisite": "Platform.sh team must provision the new Redis instance first.",
      "configuration_snippet_env_yaml": {
        "SESSION_CONFIGURATION": {
          "_merge": true,
          "redis": {
            "port": "6374 /* Check $MAGENTO_CLOUD_RELATIONSHIPS for actual port */",
            "timeout": 5, "disable_locking": 1, "bot_first_lifetime": 60, "bot_lifetime": 7200, "max_lifetime": 2592000, "min_lifetime": 60
          }
        }
      }
    },
    {
      "id": "QUALITY_PATCHES",
      "title": "Apply Quality Patches",
      "tool": "Quality Patch Tool (bin/magento support:patches --apply)",
      "patches": [
        {"id": "B2B-2674", "description": "Adds caching to customAttributeMetadata GraphQL query. Effective for headless with high GraphQL volume. Merged 2.4.7."},
        {"id": "B2B-2598", "description": "Adds caching to availableStores, countries, currency, storeConfig GraphQL queries. Effective for headless. Merged 2.4.7."},
        {"id": "MCLOUD-11514", "description": "Optimize layout cache, reduce server load after cache flush. (On-prem: ACSD-56624_2.4.6-p3.patch). Merged 2.4.7."},
        {"id": "MCLOUD-11329", "description": "Fixes missed jobs waiting for cron locks, reduces lock contention. Merged 2.4.7."},
        {"id": "ACSD-53583", "description": "Improve partial reindex for 'Category Products' & 'Product Categories'. DO NOT INSTALL IF LIVESEARCH ENABLED (use ACSD-55719 for <2.4.3-p3, not in QPT). Merged 2.4.7."},
        {"id": "ACSD-56415", "description": "Fixes slow partial price indexing (DELETE query issue). Merged 2.4.7."},
        {"id": "ACSD-53347", "description": "Fixes long price indexer execution by ensuring temp tables are dropped. Merged 2.4.7."},
        {"id": "ACSD-56226_2.4.6-p2", "description": "Fixes performance degradation with synchronous replication (set to true for consistency). (ACSD-59926_2.4.5-p1 for 2.4.5). Merged 2.4.7."},
        {"id": "ACSD-64112", "description": "Fixes 'There is no active transaction' during parallel indexing. Improves performance, reduces race conditions. For Magento < 2.4.7."},
        {"id": "ACP2E-3705", "description": "improve performance in a multithreaded environment, reduce race conditions and optimise resource cleanup, and ensure proper transaction handling. This also prevents issues with resource contention as temporary tables are removed to physical tables during the reindex.  errors like “Base table or view not found, and cron execution failures when MAGE_INDEXER_THREADS_COUNT is set. For Magento 2.4.7+."},
        {"id": "ACSD-60549_2.4.4-p8.patch", "description": "Optimizes indexing with No DDL Mode. Reduces DB load, prevents node desync. For Magento 2.4.4 experiencing indexer slowdowns/deadlocks."},
        {"id": "ACSD-62577", "description": "Optimize search query performance (restructures DB indexes, improves SQL). For all Magento versions with search slowness."},
        {"id": "ACSD-50619_2.4.5-p1_v2.patch", "description": "Improves partial indexing by preventing duplicate entity ID processing. Reduces indexing time up to 90%. Tested on 2.4.5-p1, needs testing for other versions."}
      ]
    },
    {
      "id": "FASTLY_SOFT_PURGE",
      "title": "Enable Fastly Soft Purge",
      "problem_addressed": "Hard purges can significantly impact performance by removing all cached content.",
      "recommendation": "Enable soft-purge for CMS and Category pages on Fastly.",
      "commands": [
        "bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/soft_purge 1",
        "bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/preserve_static 1",
        "bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/purge_cms_page 1",
        "bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/purge_catalog_category 1"
      ],
      "monitoring_tools": ["SWAT Report"]
    },
    {
      "id": "PHP_MEMORY_SETTINGS",
      "title": "PHP Memory Settings Optimization",
      "file_target": "php.ini",
      "recommendations": {
        "memory_limit": "2G",
        "realpath_cache_size": "10M",
        "opcache.memory_consumption": "2048"
      }
    },
    {
      "id": "OPCACHE_CONFIGURATION",
      "title": "OpCache Configuration",
      "file_target": "php.ini",
      "recommendations": [
        "opcache.validate_timestamps = 0",
        "opcache.blacklist_filename=\"${MAGENTO_CLOUD_APP_DIR}/op-exclude.txt\"",
        "opcache.max_accelerated_files=16229",
        "opcache.consistency_checks=0"
      ],
      "related_file": "op-exclude.txt",
      "op_exclude_txt_content_note": "Ensure `op-exclude.txt` has all six required lines to prevent caching of configurations, which can cause inconsistencies (e.g., cron disabling automatically).",
      "problem_addressed_by_op_exclude": "Issues where cron is disabled automatically or configs change without intervention."
    },
    {
      "id": "THIRD_PARTY_CRON_GROUPING",
      "title": "Third-Party Cron Job Grouping",
      "problem_addressed": "Cron job/indexing failures due to lock contentions and resource constraints when multiple cron jobs overlap (especially default group impacting indexer group).",
      "recommendation": "Remove all third-party cron tasks from the `default` group and add them to their own dedicated groups."
    },
    {
      "id": "CRON_USE_SEPARATE_PROCESS",
      "title": "Cron: Use Separate Process Setting",
      "recommendation_logic": {
        "enable_if": "Server has enough resources (improves cron performance).",
        "disable_if": "Server resources are limited."
      },
      "command_to_disable_globally_in_build_hook": "sed -i 's/_process>1<\\/use_/_process>0<\\/use_/g' ${MAGENTO_CLOUD_APP_DIR}/vendor/magento/*/etc/cron_groups.xml",
      "target_file_for_command": ".magento.app.yaml (hooks -> build section)",
      "note_on_command": "Sets default to 0. Manually set '1' values will persist."
    },
    {
      "id": "APPLICATION_LOCK_FOR_INDEXING",
      "title": "Enable Application Lock for Indexing",
      "problem_addressed": "Multiple indexing processes running simultaneously; improper cleanup of interrupted indexers.",
      "recommended_method_config_php": {
        "file_target": "app/etc/config.php",
        "content_snippet": { "indexer": { "use_application_lock": true } }
      },
      "deprecated_method_env_var": {
        "variable": "MAGENTO_DC_INDEXER__USE_APPLICATION_LOCK: true",
        "reason_for_deprecation": "Causes severe performance issues in Magento 2.4.6."
      }
    },
    {
      "id": "PARALLEL_REINDEX",
      "title": "Enable Parallel Reindex",
      "problem_addressed": "Slow indexing.",
      "recommendation": "Enable parallel indexing.",
      "configuration_snippet_app_yaml": {
        "variables": { "env": { "MAGE_INDEXER_THREADS_COUNT": "8 /* Max value < nproc result. >8 shows little extra improvement. */" } }
      },
      "associated_patch_needed": "ACSD-64112 (or equivalent for version) to solve 'PDOException: There is no active transaction'.",
      "rimom_observation": "Some indexers faster, others slower, but total time up to 53% faster. Varies per case."
    },
    {
      "id": "DIMENSION_MODE_PRICE_INDEXING",
      "title": "Dimension Mode for Product Price Indexing",
      "problem_addressed": "High memory usage during price indexing, issues with other indexers.",
      "recommendation": "Implement dimension-based indexing for product prices (website_and_customer_group).",
      "how_it_works": "Splits price data into smaller chunks based on website/customer group.",
      "impact": "Increases disk/CPU usage but reduces memory usage per operation during price indexing.",
      "command": "bin/magento indexer:set-dimensions-mode catalog_product_price website_and_customer_group"
    },
    {
      "id": "INDEX_BATCH_SIZE_CONFIGURATION",
      "title": "Configure Indexer Batch Sizes",
      "problem_addressed": "Optimize memory usage, prevent resource contention, address frequent indexing failures.",
      "guidance": {
        "reduce_values_if": "Limited memory, complex products, frequent failures (indexer may take longer).",
        "increase_values_if": "Indexing too slow, ample memory (beware of `max_heap_table_size`, `tmp_table_size` usage; if >20% of `innodb_buffer_pool_size`, may error)."
      },
      "configuration_snippet_app_yaml": {
        "variables": {
          "env": { /* See original for full list of MAGENTO_INDEXER_BATCH_SIZE__* variables */ }
        }
      },
      "note": "Values are balanced starting points; optimal values depend on catalog size, server resources, indexing patterns."
    },
    {
      "id": "FORCE_FULL_REINDEX",
      "title": "Force Full Reindex",
      "problem_addressed": "Several indexers stuck with large backlog (common after node restart or killed process).",
      "command_full_reindex": "php vendor/bin/ece-tools cron:kill; php vendor/bin/ece-tools cron:unlock; vendor/bin/ece-tools cron:disable; php bin/magento indexer:info | awk '{print $1}' | xargs -I {} bash -c 'php bin/magento indexer:reset {} && php bin/magento indexer:reindex {}' && vendor/bin/ece-tools cron:enable;",
      "preferred_command_specific_indexer": "MAGE_INDEXER_THREADS_COUNT=4 bin/magento indexer:reset <indexer_name> && php -d memory_limit=-1 bin/magento indexer:reindex <indexer_name>"
    },
    {
      "id": "TABLE_CARDINALITY_UPDATE",
      "title": "Update Table Statistics (Cardinality)",
      "problem_addressed": "Performance degradation due to outdated table statistics after DDL/DML, leading to suboptimal query execution plans.",
      "recommendation": "Run `ANALYZE TABLE` for all tables.",
      "command_template": "mysqlcheck -h<host_name> -u<user_name> -p -a <db_name>",
      "command_for_cloud": "mysqlcheck -h$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].host) -u$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].username) -p$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].password) -a $(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].path)",
      "timing": "Execute with cron disabled, out of business hours (may lock tables, rarely >1 min).",
      "frequency": "At least once a month, or after >30% change in a table.",
      "explanation_if_asked": "DDL (e.g., ALTER TABLE using COPY algorithm) doesn't copy statistics. They need regeneration via ANALYZE TABLE. If no performance change, stats were already optimal."
    },
    {
      "id": "LARGE_TABLES_REDUCTION",
      "title": "Reduce Large Tables",
      "problem_addressed": "Tables > 1GB can cause performance degradation.",
      "recommendation": "Truncate identified large tables. Perform backup first. Check with dev team if data is still relevant.",
      "source_of_table_list": "SWAT Report"
    },
    {
      "id": "MYSQL_TRIGGERS_REVIEW",
      "title": "Review MySQL Triggers",
      "problem_addressed": "Triggers are interpreted (not pre-compiled), adding parsing/interpreting overhead. Compete for locks with queries in the same transaction space, affecting DB performance.",
      "recommendation": "Consider moving trigger logic to application code.",
      "source_of_trigger_list": "SWAT Report"
    },
    {
      "id": "FAILED_CACHE_FLUSH_DURING_DEPLOYMENT",
      "title": "Handle Failed Cache Flush During Deployment",
      "problem_addressed": "Redis refuses to flush cache during deployment due to high request volume (often from customizations).",
      "solution_steps": [
        "1. Identify Redis master: `redis-cli -p 5000 SENTINEL get-master-addr-by-name mymaster` (Example output: `1) \"192.168.7.7\" 2) \"26370\"`)",
        "2. Flush DB 1 (cache) on master: `redis-cli -h <master_ip> -p <master_port> -n 1 FLUSHDB` (e.g., `redis-cli -h 192.168.7.7 -p 26370 -n 1 FLUSHDB`)"
      ],
      "note": "`-n 1` flushes cache DB, leaves sessions (DB 0) untouched."
    },
    {
      "id": "JS_CSS_MINIFICATION",
      "title": "Enable JS and CSS Minification",
      "problem_addressed": "Frontend performance optimization.",
      "recommendation": "Enable JS and CSS minification.",
      "commands_local": [
        "bin/magento config:set --lock-config dev/js/minify_files 1",
        "bin/magento config:set --lock-config dev/css/minify_files 1"
      ],
      "deployment_step": "Commit changes to `app/etc/config.php` and trigger new deployment.",
      "monitoring_tools": ["SWAT Report"]
    },
    {
      "id": "ADVANCED_REDIS_ASYNCHRONOUS_OPS",
      "title": "Advanced: Redis Asynchronous Operations (Lazyfree)",
      "problem_addressed": "Redis latency, low throughput, errors like 'Can not connect to localhost:6379'.",
      "recommendation": "Request Platform.sh team to apply lazyfree configurations.",
      "configurations": [
        "lazyfree-lazy-eviction yes", "lazyfree-lazy-expire yes", "lazyfree-lazy-server-del yes",
        "replica-lazy-flush yes", "lazyfree-lazy-user-del yes"
      ],
      "impact": "Minimizes latency, enhances throughput by making some operations asynchronous.",
      "when_to_suggest": "Only when other options haven't helped.",
      "caveat": "Increases Redis memory consumption. NEVER suggest if merchant has high Redis memory usage issues."
    },
    {
      "id": "ADVANCED_TABLE_OPTIMIZATION_FRAGMENTATION",
      "title": "Advanced: Optimize Tables for Fragmentation",
      "problem_addressed": "Table fragmentation compromising DB performance.",
      "recommendation": "Run `OPTIMIZE TABLE`.",
      "command_template": "mysqlcheck -h<host_name> -u<user_name> -p -o <db_name>",
      "timing": "Execute with cron disabled, out of business hours (may lock tables, can take longer than ANALYZE). Perform full DB backup first.",
      "note": "More aggressive than `ANALYZE TABLE`."
    },
    {
      "id": "ADVANCED_MYSQL_QUERY_CACHE_TUNING",
      "title": "Advanced: MySQL Query Cache Tuning",
      "background": "Query cache stores SELECT results. Speeds up frequent, unchanging queries. In Galera, local node caches can lead to inconsistencies. Maintaining sync adds overhead, especially in write-heavy environments. Generally advised to disable in Galera.",
      "case_by_case_approach": "Results vary; sometimes disabling degrades, sometimes improves performance.",
      "diagnostic_query": "/* SQL query provided in original text to get cache size, usage, hit ratio, prunes, and suggestion */",
      "default_setting": "256 MB for all merchants.",
      "observed_adjustments": "Reduced to 16MB or disabled in some cases.",
      "command_to_check_current_size": "SELECT variable_value / 1024 / 1024 AS query_cache_size_in_MB FROM information_schema.global_variables WHERE variable_name = 'query_cache_size';",
      "change_agent": "Platform.sh team."
    },
    {
      "id": "ADVANCED_INNODB_BUFFER_POOL_TUNING",
      "title": "Advanced: InnoDB Buffer Pool Size Tuning",
      "purpose": "Caches data and indexes of InnoDB tables to reduce disk I/O.",
      "recommendation_query_for_ideal_size": "SELECT CONCAT(CEILING(Total_InnoDB_Bytes*0.8/POWER(1024,3)), ' GB') AS Recommended FROM (SELECT SUM(data_length+index_length) Total_InnoDB_Bytes FROM information_schema.tables WHERE engine='InnoDB') A;",
      "rationale_for_query": "Commonly recommended ~80% of total InnoDB dataset size, if sufficient RAM available.",
      "change_agent": "Platform.sh team."
    },
    {
      "id": "ADVANCED_SEQUENTIAL_CRON_JOBS",
      "title": "Advanced: Sequential Cron Jobs",
      "problem_addressed": "Resource constraints, especially on Starter Accounts, preventing even full reindex.",
      "recommendation": "Configure cron jobs to run sequentially instead of in parallel.",
      "configuration_snippet_app_yaml_crons": {
        "crons": {
          "magento": {
            "spec": "* * * * *",
            "cmd": "bash -c 'for group in $(grep -shoP \"(?<=<group id=\\\")(.+)(?=\\\">)\" {app,vendor}/*/*/etc/cron_groups.xml); do echo -n Running cron group ${group} --- && php -d memory_limit=-1 bin/magento cron:run --group=${group}; done'"
          }
        }
      },
      "rimom_usage_note": "Recommended a couple of times for Starter. Not for Pro accounts; prefer upsize if Pro reaches this point."
    }
  ],
  "standard_responses_and_justifications": {
    "justification_for_multiple_recommendations": {
      "trigger": "Merchant complains about too many recommendations at once.",
      "message_template": {
        "greeting": "Hello {merchant_name},",
        "body": [
          "Adobe Commerce Cloud operates under a shared responsibility model. Adobe ensures platform stability and provides performance-enhancing patches, but it's the merchant’s responsibility to keep their Magento instance up-to-date (applying patches, best practices, configurations).",
          "Adobe doesn't enforce patches/recommendations immediately, allowing merchants flexibility. However, delaying these leads to accumulated inefficiencies (outdated configs, inefficient caching, increased data load) that manifest as severe performance issues when a critical threshold is reached.",
          "Needing many fixes now indicates best practices weren't consistently applied. E.g., Redis L2 cache (released since Magento 2.3) drastically reduces intra-node network load.",
          "We highly recommend proceeding with suggested patches/optimizations. If issues persist after, it helps isolate the root cause more effectively."
        ]
      }
    },
    "redis_read_error_localhost_6370": {
      "trigger_error": "read error on connection to tcp://localhost:6370",
      "explanation": "Redis refuses/times out connections due to being overwhelmed (too many simultaneous connections/operations). Culprit: usually third-party modules with excessive caching, concurrent with cron, API, cache flushes.",
      "suggestion_for_dev_team": "Use profiling tools (Mage Profiler, Blackfire) to identify high load in transactions (e.g., catalog/category/view).",
      "interim_actions_placeholder": "<actions_list>",
      "actions_to_include": [
        "Increase Redis timeout", "Enable lazyfree*", "Enable stale cache", "Split Redis (sessions)",
        "Enable pre-load keys", "Disable block_html cache (with Fastly soft purge)", "Apply relevant patches for caching."
      ],
      "ai_leverage_note": "AI tools should help identify problematic customizations in <15 mins (see 'Leverage AI for transaction trace analysis')."
    },
    "nginx_worker_connections_not_enough": {
      "trigger_error": "worker_connections are not enough",
      "explanation": "Nginx reached max simultaneous connections per worker. New connections dropped/delayed. Often co-occurs with '104: Connection reset by peer' (PHP worker closed connection without response - timeout, memory limit, fatal error, SIGSEGV), causing Nginx to hold connections.",
      "common_causes": "Heavy traffic (bots, API), un-warmed cache. Cache flush *shouldn't* cause it, but third-party modules can slow PHP workers (excessive DB queries, complex/unoptimized code, poor cache management, heavy computations, interference with native caching).",
      "why_not_increase_nginx_workers": "Can worsen problem. More Nginx workers -> more requests to PHP-FPM -> surge in PHP processes -> CPU/memory pressure -> contention/delays. Core issue is backend processing slowness.",
      "suggestion_for_dev_team": "Use profiling tools (Mage Profiler, Blackfire) to pinpoint modules/code extending PHP processing times.",
      "interim_actions_placeholder": "<actions_list>",
      "actions_to_include": [
        "Enable stale cache", "Split Redis (sessions)", "Enable pre-load keys", "Ensure Fastly soft purge enabled."
        // Add other general performance improvement suggestions.
      ],
      "ai_leverage_note": "AI tools should help identify problematic customizations in <15 mins."
    },
    "request_to_increase_php_workers": {
      "trigger_request": "Merchant asks to increase PHP workers (pm.max_children).",
      "response_logic": "Not recommended, can cause severe side effects.",
      "example_calculation_for_denial": {
        "current_pm_max_children": "38 (from `/etc/platform/<project_id>/php-fpm.conf`)",
        "current_php_memory_settings": {
          "memory_limit": "4G (php.ini)",
          "opcache.memory_consumption": "2048MB (2G) (php.ini)"
        },
        "total_per_worker_potential_ram": "6GB (4G PHP + 2G Opcache) - soft limit, actual may be higher.",
        "conservative_estimate_per_worker": "6.2GB",
        "total_potential_ram_for_php": "38 workers * 6.2 GB = 235.6 GB",
        "server_total_ram_example": "246 GiB",
        "conclusion": "Leaves little headroom for MySQL, Redis, cron, system processes. Current config already pushes limits."
      },
      "impact_of_upsize_and_more_workers": "May shift bottleneck to database. Adobe Commerce Cloud uses Galera (multi-master) simulating master-slave. More PHP workers might hit the same DB node -> contention, severe performance degradation.",
      "alternative_recommendations": "Optimize custom code to reduce memory/request, reduce PHP memory_limit where possible, minimize data processed per request (especially long-running ops). This is more sustainable than vertical scaling."
    }
  },
{
"be aware of": "A config cache flush can cause Magento to parse over 1300 config files when rebuilding the config cache"
}
}