platform:
  name: Adobe Commerce Cloud
  description: Magento (Adobe Commerce) running on Platform.sh infrastructure
  
  standard_pro_architecture:
    database:
      type: MariaDB
      clustering: Galera Cluster
      nodes: 3
      replication_model: Multi-Master
      simulated_behavior: Master-Slave
      ports:
        master_node: 3306
        slave_connections: 3304
        local_node_direct: 3307
        local_node_note: Bypasses load balancer; good for database dumps
    
    caching:
      service: Redis
      high_availability: Sentinel
      ports:
        master_instance: 6370
        slave_instance: 26370
      l1_cache_location: /dev/shm
    
    cdn:
      service: Fastly
    
    messaging_queue:
      service: RabbitMQ
    
    distributed_file_system:
      service: GlusterFS
      purpose: Combines all volumes across nodes
    
    search_engine:
      service: OpenSearch
    
    job_scheduler:
      service: Cron
    
    lock_manager:
      mechanism: Zookeeper
      lock_file_path_template: /run/<project-id>/locks/
      implementation_detail: This path is a mount point for Zookeeper, managing locks across all three nodes
  
  split_architecture:
    description: Merchants can upgrade to a split architecture for increased capacity
    total_nodes: ">3 (e.g., 3, 6, 9, 12)"
    
    core_nodes:
      count: First 3 nodes from original Pro architecture
      role: Dedicated to services (MariaDB, Redis, etc.)
    
    web_nodes:
      count: Additional nodes beyond the core 3
      role: Handle web traffic, primarily run PHP-FPM
      cron_offload: Cron jobs can be moved to web nodes if core nodes are overwhelmed
    
    auto_scaling:
      availability: Optional feature
      scope: Web nodes scale horizontally
      trigger_threshold_default: 70% load
      trigger_threshold_customizable: Merchants may adjust (e.g., to 50%)
      activation_time: 15-30 minutes

support_scope:
  common_merchant_excuse: It works on my local environment
  
  reasons_for_discrepancy:
    - Vastly different data volumes in cloud vs. local
    - Different resource allocations (CPU, memory, network)
    - Presence of data synchronization processes across regions in cloud
    - High number of cron jobs running in parallel in cloud
    - Complexities of distributed services not present locally
  
  third_party_customizations:
    policy: Not officially supported
    common_issue_source: Most issues are caused by these customizations
    approach: Attempt to identify the problematic customization and provide limited guidance
    avoidance_goal: Do not become the owner of unsupported issues
  
  unsupported_configuration_changes:
    - service: Redis
      detail: Will not change session storage to Database or cache to disk, even for testing. Redis is the standard
      cache_lock_manager: LockGuardedCacheLoader::lockedLoadData
    
    - service: Lock Manager
      detail: Lock file path /run/<project-id>/locks/ (Zookeeper) is fixed and will not be changed
    
    - service: Nginx/PHP Workers
      detail: Number of Nginx or PHP workers is defined by Platform.sh team and not changed on request
    
    - general: Many other configurations defined by Platform.sh (PSH) are fixed
  
  common_performance_issues:
    - N+1 query problems in third-party modules
    - Excessive PHP memory_limit settings (e.g., 6GB) combined with deep recursion, leading to resource exhaustion
    - Concurrency issues with multiple heavy transactions running simultaneously with cache flushes and indexing

troubleshooting_playbook:
  
  optimal_configurations:
    
    magento_env_yaml:
      description: Recommended settings in .magento.env.yaml for performance and stability
      
      stage:
        global:
          SCD_ON_DEMAND: false  # True for minimal deployment time - More used for development
          CLEAN_STATIC_FILES: true  # For dev or debug only
        
        build:
          SKIP_SCD: false  # Set to true if deployment is not changing anything in the frontstore
          SCD_THREADS: 4
          SCD_MATRIX:
            Magento/backend:
              language: [en_US]
            Magento/blank:
              language: [en_US]
            Magento/luma:
              language: [en_US]
          
          QUALITY_PATCHES:
            - MCLOUD-11329  # Fix: missed jobs waiting for cron locks, reduces lock contention. Merged 2.4.7
            - MCLOUD-11514  # Optimize layout cache, reduce server load post-cache flush. Merged 2.4.7
            - B2B-2674  # Add caching to customAttributeMetadata GraphQL query. Merged 2.4.7
            - B2B-2598  # Add caching to availableStores, countries, etc. GraphQL queries. Merged 2.4.7
            - ACSD-53583  # Improve partial reindex for Category Products & Product Categories. Merged 2.4.7. Not for Live Search
            - ACSD-56415  # Fix slow partial price indexing due to DELETE query. Merged 2.4.7
        
        deploy:
          SCD_STRATEGY: compact
          MYSQL_USE_SLAVE_CONNECTION: true
          REDIS_USE_SLAVE_CONNECTION: true  # Disable for clusters > 3 nodes (Split Architecture)
          REDIS_BACKEND: \Magento\Framework\Cache\Backend\RemoteSynchronizedCache  # Enable L2 cache
          
          CACHE_CONFIGURATION:
            _merge: true
            default:
              backend_options:
                use_stale_cache: true
            stale_cache_enabled:
              backend_options:
                use_stale_cache: true
            type:
              default:
                frontend: default
              layout:
                frontend: stale_cache_enabled
              block_html:
                frontend: stale_cache_enabled
              reflection:
                frontend: stale_cache_enabled
              config_integration:
                frontend: stale_cache_enabled
              config_integration_api:
                frontend: stale_cache_enabled
              full_page:
                frontend: stale_cache_enabled
              translate:
                frontend: stale_cache_enabled
            frontend:
              default:
                id_prefix: '061_'  # Prefix for keys to be preloaded - Any random string
                backend_options:
                  read_timeout: 10  # Default 5; increase for Redis issues
                  connect_retries: 2  # Increase for Redis sync issues
                  compress_data: 4
                  compress_tags: 4
                  compress_threshold: 20480
                  compression_lib: gzip  # snappy/lzf for performance, gzip for high compression
                  preload_keys:
                    - '061_EAV_ENTITY_TYPES:hash'
                    - '061_GLOBAL_PLUGIN_LIST:hash'
                    - '061_DB_IS_UP_TO_DATE:hash'
                    - '061_SYSTEM_DEFAULT:hash'
          
          SESSION_CONFIGURATION:
            _merge: true
            redis:
              timeout: 5
              disable_locking: 1
              bot_first_lifetime: 60
              bot_lifetime: 7200
              max_lifetime: 2592000
              min_lifetime: 60
          
          CRON_CONSUMERS_RUNNER:
            cron_run: true
            max_messages: 1000
            consumers: []
        
        post-deploy:
          WARM_UP_CONCURRENCY: 4
          WARM_UP_PAGES:
            - 'category:*:1'
    
    magento_app_yaml:
      description: Recommended environment variables in .magento.app.yaml for indexing and PayPal
      
      variables:
        env:
          CONFIG__DEFAULT__PAYPAL_ONBOARDING__MIDDLEMAN_DOMAIN: payment-broker.magento.com
          CONFIG__STORES__DEFAULT__PAYPAL__NOTATION_CODE: Magento_Enterprise_Cloud
          MAGE_INDEXER_THREADS_COUNT: 4
          MAGENTO_DC_INDEXER__USE_APPLICATION_LOCK: true  # Caution: Performance issues in Magento 2.4.6. Prefer config.php method
          MAGENTO_INDEXER_BATCH_SIZE__CATALOGINVENTORY_STOCK__SIMPLE: 200
          MAGENTO_INDEXER_BATCH_SIZE__CATALOG_CATEGORY_PRODUCT: 666
          MAGENTO_INDEXER_BATCH_SIZE__CATALOGSEARCH_FULLTEXT__PARTIAL_REINDEX: 100
          MAGENTO_INDEXER_BATCH_SIZE__CATALOGSEARCH_FULLTEXT__MYSQL_GET: 500
          MAGENTO_INDEXER_BATCH_SIZE__CATALOGSEARCH_FULLTEXT__ELASTIC_SAVE: 500
          MAGENTO_INDEXER_BATCH_SIZE__CATALOG_PRODUCT_PRICE__SIMPLE: 200
          MAGENTO_INDEXER_BATCH_SIZE__CATALOG_PRODUCT_PRICE__DEFAULT: 500
          MAGENTO_INDEXER_BATCH_SIZE__CATALOG_PRODUCT_PRICE__CONFIGURABLE: 666
          MAGENTO_INDEXER_BATCH_SIZE__CATALOGPERMISSIONS_CATEGORY: 999
          MAGENTO_INDEXER_BATCH_SIZE__INVENTORY__SIMPLE: 210
          MAGENTO_INDEXER_BATCH_SIZE__INVENTORY__DEFAULT: 510
          MAGENTO_INDEXER_BATCH_SIZE__INVENTORY__CONFIGURABLE: 616

  cache_management:
    
    cache_flush_best_practice:
      problem: Performance impact of cache flushes
      recommendation: Avoid performing actions that flush the cache during business hours
      monitoring_tools:
        - SWAT (look for Dangerous actions)
        - Observation Tool
        - New Relic (Infrastructure > Third-party services > Redis)
    
    cacheable_false_issue:
      problem: Pages not being cached due to a block with cacheable=false flag
      impact: If cacheable=false is in a block, the entire page is not cacheable. If in default.xml, the entire website is not cacheable
      recommendation: Move non-cacheable blocks to a private content mechanism
      monitoring_tools:
        - SWAT (list of non-cached pages)
    
    l1_l2_cache_limits:
      problem: Suboptimal performance due to mismatched L1/L2 cache sizes or excessive Redis memory usage
      recommendation: Reduce Redis maxmemory to 10 GB and /dev/shm to 15 GB. Change done by Platform.sh team
      condition: Suggest if Redis maxmemory usage is high or /dev/shm usage is high (same as Redis or higher). Ignore if Redis usage is low
      
      rationale_10gb_redis:
        network_intensive_sync: Redis data syncs across 3 nodes over the network. 20GB Redis would need 160Gbps for 1s sync or 32Gbps for 5s sync. Max cluster bandwidth is ~25Gbps. So 20GB sync takes ~6.4s (ideal), exceeding Redis timeouts
        sync_time_10gb: ~3.2s on 25Gbps cluster, ~10s on 8Gbps cluster. Still long, may need timeout adjustments
        root_cause: Often due to customizations generating excessive keys. Profiling needed
        other_reasons: Memory Pressure (GC, OOM), CPU Utilization, Disk I/O (swapping), Network Congestion
      
      rationale_15gb_shm: Matching L1 (/dev/shm) and L2 (Redis maxmemory). L2 at 10GB, L1 should match. Extra 50% (5GB) for /dev/shm buffer for other services, totaling 15GB
      
      l2_behavior:
        operation: Magento checks L1 (/dev/shm) first. If not found, checks L2 (Redis). If not in L2, stores in L2 then L1. Next time, compares L1 hash with L2. If same, loads from L1. If different, new key in L1 & L2
        eviction_policy_magento: No real eviction. Flushes L1 if usage reaches 95% (1/1000 checks)
        eviction_policy_redis: Redis manages its own evictions
        scenario_l2_bigger: L1 fills quickly, Magento flushes it, invalidating L2 keys (hash mismatch). Causes performance degradation, chain reaction, increased network traffic
        scenario_l1_bigger: L1 fills with expired keys (Magento no eviction). Problems include long L1 parse time, memory fragmentation, unnecessary resource usage
        conclusion: Matching L1 and L2 (with L1 buffer) prevents these issues
    
    l2_cache_enable:
      problem: High inter-node network traffic, slow cache loading
      recommendation: Enable Redis L2 cache
      how_it_works: Magento reads from local L1 (/dev/shm) first. If not found, checks remote L2 (Redis). Reduces inter-node traffic, improves cache load time
      configuration:
        REDIS_BACKEND: \Magento\Framework\Cache\Backend\RemoteSynchronizedCache
      note: L2 cache is a newer implementation, not default on provisioned servers
    
    stale_cache:
      problem: High server load or crashes after cache flush; reduces DB load
      recommendation: Enable stale cache to serve expired cache data while new data is regenerated
      note: Configuration should be added in config.php, not .magento.env.yaml due to ece-tools issue
    
    preload_keys:
      problem: Latency from multiple network requests to Redis for individual keys; reduces load on web nodes
      recommendation: Enable pre-load keys to fetch frequently used keys in bulk during initialization and store in Magento's memory
      identification:
        monitor_command: redis-cli -p 6370 -n 1 MONITOR > /tmp/list.keys (run for ~10s)
        analyze_command: cat /tmp/list.keys| grep "HGET"| awk '{print $5}'|sort |uniq -c | sort -nr|head -n50
        view_key: redis-cli -p 6370 -n 1 hgetall "<key_name>"
    
    parallel_cache_generation:
      problem: Lock contention issues, slow cache generation under heavy load, especially with high Redis usage
      recommendation: Enable parallel cache generation with allow_parallel_generation: true
      deactivation_note: Once activated, can only be deactivated by removing config from env.php
      monitoring: New Relic shows extended time on LockGuardedCacheLoader (Cache lock handler) during lock contention
    
    block_html_disable:
      problem: High Redis cache usage, aim to reduce it
      recommendation: Temporarily disable Magento's block_html cache, relying on Fastly for this layer
      command: bin/magento cache:disable block_html
      caveat: Merchant may never re-enable it. Keeping disabled can increase server load if Fastly cache is purged. Must recommend Fastly Soft Purge and Enable Stale Cache alongside
      conditions: Temporary measure until dev team optimizes customizations reducing Redis hits/cache usage
    
    redis_compression:
      problem: High Redis memory usage
      recommendation: Compress cache keys in Redis
      configuration:
        compress_data: 4
        compress_tags: 4
        compress_threshold: 20480
        compression_lib: gzip

  redis_optimization:
    
    slave_connection:
      problem: Reduces load on Redis master by directing read operations to slaves
      recommendation: Enable Redis slave connection with REDIS_USE_SLAVE_CONNECTION: true
      caveat: Do NOT suggest for split architecture (more than three nodes)
    
    timeout_increase:
      problem: Redis errors like 'Can not connect to localhost:6379', especially during high load
      recommendation: Increase Redis read_timeout to 10 and connect_retries to 3
      monitoring: Easily spotted in New Relic
    
    split_redis_sessions:
      problem: Session-related issues, Redis nearing maxmemory limit, distribute load
      recommendation: Save sessions in a different Redis instance. New instance should run on its own core
      prerequisite: Platform.sh team must provision the new Redis instance first
    
    lazyfree_operations:
      problem: Redis latency, low throughput, errors like 'Can not connect to localhost:6379'
      recommendation: Request Platform.sh team to apply lazyfree configurations
      configurations:
        - lazyfree-lazy-eviction yes
        - lazyfree-lazy-expire yes
        - lazyfree-lazy-server-del yes
        - replica-lazy-flush yes
        - lazyfree-lazy-user-del yes
      impact: Minimizes latency, enhances throughput by making some operations asynchronous
      when_to_suggest: Only when other options haven't helped
      caveat: Increases Redis memory consumption. NEVER suggest if merchant has high Redis memory usage issues

  database_optimization:
    
    mysql_slave_connection:
      problem: Reduces load on MySQL master by directing read operations to slaves
      recommendation: Enable MySQL Slave Connection with MYSQL_USE_SLAVE_CONNECTION: true
    
    table_cardinality:
      problem: Performance degradation due to outdated table statistics after DDL/DML, leading to suboptimal query execution plans
      recommendation: Run ANALYZE TABLE for all tables
      command: mysqlcheck -h$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].host) -u$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].username) -p$(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].password) -a $(echo $MAGENTO_CLOUD_RELATIONSHIPS | base64 -d | jq -r .database[0].path)
      timing: Execute with cron disabled, out of business hours (may lock tables, rarely >1 min)
      frequency: At least once a month, or after >30% change in a table
      explanation: DDL doesn't copy statistics. They need regeneration via ANALYZE TABLE
    
    large_tables_reduction:
      problem: Tables > 1GB can cause performance degradation
      recommendation: Truncate identified large tables. Perform backup first. Check with dev team if data is still relevant
      source: SWAT Report
    
    mysql_triggers_review:
      problem: Triggers are interpreted (not pre-compiled), adding parsing/interpreting overhead. Compete for locks with queries
      recommendation: Consider moving trigger logic to application code
      source: SWAT Report
    
    table_optimization_fragmentation:
      problem: Table fragmentation compromising DB performance
      recommendation: Run OPTIMIZE TABLE with mysqlcheck -o
      timing: Execute with cron disabled, out of business hours (may lock tables, can take longer than ANALYZE). Perform full DB backup first
      note: More aggressive than ANALYZE TABLE
    
    query_cache_tuning:
      background: Query cache stores SELECT results. In Galera, local node caches can lead to inconsistencies. Generally advised to disable in Galera
      approach: Results vary; sometimes disabling degrades, sometimes improves performance
      default_setting: 256 MB for all merchants
      observed_adjustments: Reduced to 16MB or disabled in some cases
      change_agent: Platform.sh team
    
    innodb_buffer_pool:
      purpose: Caches data and indexes of InnoDB tables to reduce disk I/O
      recommendation_query: SELECT CONCAT(CEILING(Total_InnoDB_Bytes*0.8/POWER(1024,3)), ' GB') AS Recommended FROM (SELECT SUM(data_length+index_length) Total_InnoDB_Bytes FROM information_schema.tables WHERE engine='InnoDB') A;
      rationale: Commonly recommended ~80% of total InnoDB dataset size, if sufficient RAM available
      change_agent: Platform.sh team

  indexing_optimization:
    
    application_lock:
      problem: Multiple indexing processes running simultaneously; improper cleanup of interrupted indexers
      recommended_method: Add to app/etc/config.php - indexer: { use_application_lock: true }
      deprecated_method: MAGENTO_DC_INDEXER__USE_APPLICATION_LOCK environment variable
      deprecation_reason: Causes severe performance issues in Magento 2.4.6
    
    parallel_reindex:
      problem: Slow indexing
      recommendation: Enable parallel indexing with MAGE_INDEXER_THREADS_COUNT
      configuration: MAGE_INDEXER_THREADS_COUNT: 8  # Max value < nproc result. >8 shows little extra improvement
      associated_patch: ACSD-64112 (or equivalent) to solve 'PDOException: There is no active transaction'
      observation: Some indexers faster, others slower, but total time up to 53% faster. Varies per case
    
    dimension_mode_price:
      problem: High memory usage during price indexing, issues with other indexers
      recommendation: Implement dimension-based indexing for product prices (website_and_customer_group)
      how_it_works: Splits price data into smaller chunks based on website/customer group
      impact: Increases disk/CPU usage but reduces memory usage per operation during price indexing
      command: bin/magento indexer:set-dimensions-mode catalog_product_price website_and_customer_group
    
    batch_size_configuration:
      problem: Optimize memory usage, prevent resource contention, address frequent indexing failures
      guidance:
        reduce_if: Limited memory, complex products, frequent failures (indexer may take longer)
        increase_if: Indexing too slow, ample memory (beware of max_heap_table_size, tmp_table_size usage)
      note: Values are balanced starting points; optimal values depend on catalog size, server resources, indexing patterns
    
    force_full_reindex:
      problem: Several indexers stuck with large backlog (common after node restart or killed process)
      command_full: php vendor/bin/ece-tools cron:kill; php vendor/bin/ece-tools cron:unlock; vendor/bin/ece-tools cron:disable; php bin/magento indexer:info | awk '{print $1}' | xargs -I {} bash -c 'php bin/magento indexer:reset {} && php bin/magento indexer:reindex {}' && vendor/bin/ece-tools cron:enable;
      preferred_command: MAGE_INDEXER_THREADS_COUNT=4 bin/magento indexer:reset <indexer_name> && php -d memory_limit=-1 bin/magento indexer:reindex <indexer_name>

  quality_patches:
    tool: Quality Patch Tool (bin/magento support:patches --apply)
    
    patches:
      - id: B2B-2674
        description: Adds caching to customAttributeMetadata GraphQL query. Effective for headless with high GraphQL volume
        merged_in: 2.4.7
      
      - id: B2B-2598
        description: Adds caching to availableStores, countries, currency, storeConfig GraphQL queries. Effective for headless
        merged_in: 2.4.7
      
      - id: MCLOUD-11514
        description: Optimize layout cache, reduce server load after cache flush
        on_prem_equivalent: ACSD-56624_2.4.6-p3.patch
        merged_in: 2.4.7
      
      - id: MCLOUD-11329
        description: Fixes missed jobs waiting for cron locks, reduces lock contention
        merged_in: 2.4.7
      
      - id: ACSD-53583
        description: Improve partial reindex for Category Products & Product Categories
        warning: DO NOT INSTALL IF LIVESEARCH ENABLED (use ACSD-55719 for <2.4.3-p3, not in QPT)
        merged_in: 2.4.7
      
      - id: ACSD-56415
        description: Fixes slow partial price indexing (DELETE query issue)
        merged_in: 2.4.7
      
      - id: ACSD-53347
        description: Fixes long price indexer execution by ensuring temp tables are dropped
        merged_in: 2.4.7
      
      - id: ACSD-56226_2.4.6-p2
        description: Fixes performance degradation with synchronous replication
        version_note: ACSD-59926_2.4.5-p1 for 2.4.5
        merged_in: 2.4.7
      
      - id: ACSD-64112
        description: Fixes 'There is no active transaction' during parallel indexing. Improves performance, reduces race conditions
        for_version: Magento < 2.4.7
      
      - id: ACP2E-3705
        description: Improve performance in multithreaded environment, reduce race conditions and optimise resource cleanup, ensure proper transaction handling. Prevents issues with resource contention as temporary tables are removed to physical tables during reindex
        for_version: Magento 2.4.7+
      
      - id: ACSD-60549_2.4.4-p8.patch
        description: Optimizes indexing with No DDL Mode. Reduces DB load, prevents node desync
        for_version: Magento 2.4.4 experiencing indexer slowdowns/deadlocks
      
      - id: ACSD-62577
        description: Optimize search query performance (restructures DB indexes, improves SQL)
        for_version: All Magento versions with search slowness
      
      - id: ACSD-50619_2.4.5-p1_v2.patch
        description: Improves partial indexing by preventing duplicate entity ID processing. Reduces indexing time up to 90%
        for_version: Tested on 2.4.5-p1, needs testing for other versions

  fastly_optimization:
    
    soft_purge:
      problem: Hard purges can significantly impact performance by removing all cached content
      recommendation: Enable soft-purge for CMS and Category pages on Fastly
      commands:
        - bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/soft_purge 1
        - bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/preserve_static 1
        - bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/purge_cms_page 1
        - bin/magento config:set system/full_page_cache/fastly/fastly_advanced_configuration/purge_catalog_category 1
      monitoring: SWAT Report

  php_optimization:
    
    memory_settings:
      file: php.ini
      recommendations:
        memory_limit: 2G
        realpath_cache_size: 10M
        opcache.memory_consumption: 2048
    
    opcache_configuration:
      file: php.ini
      recommendations:
        - opcache.validate_timestamps = 0
        - opcache.blacklist_filename="${MAGENTO_CLOUD_APP_DIR}/op-exclude.txt"
        - opcache.max_accelerated_files=16229
        - opcache.consistency_checks=0
      related_file: op-exclude.txt
      note: Ensure op-exclude.txt has all six required lines to prevent caching of configurations
      problem_addressed: Issues where cron is disabled automatically or configs change without intervention

  cron_optimization:
    
    third_party_grouping:
      problem: Cron job/indexing failures due to lock contentions when multiple cron jobs overlap
      recommendation: Remove all third-party cron tasks from the default group and add them to their own dedicated groups
    
    use_separate_process:
      enable_if: Server has enough resources (improves cron performance)
      disable_if: Server resources are limited
      command: sed -i 's/_process>1<\\/use_/_process>0<\\/use_/g' ${MAGENTO_CLOUD_APP_DIR}/vendor/magento/*/etc/cron_groups.xml
      target_file: .magento.app.yaml (hooks -> build section)
      note: Sets default to 0. Manually set '1' values will persist
    
    sequential_jobs:
      problem: Resource constraints, especially on Starter Accounts, preventing even full reindex
      recommendation: Configure cron jobs to run sequentially instead of in parallel
      note: Recommended for Starter accounts. Not for Pro; prefer upsize if Pro reaches this point

  frontend_optimization:
    
    js_css_minification:
      problem: Frontend performance optimization
      recommendation: Enable JS and CSS minification
      commands:
        - bin/magento config:set --lock-config dev/js/minify_files 1
        - bin/magento config:set --lock-config dev/css/minify_files 1
      deployment: Commit changes to app/etc/config.php and trigger new deployment
      monitoring: SWAT Report

  third_party_module_investigation:
    problem: Performance issues (e.g., high Redis/DB requests) traced to third-party modules
    example: Transaction catalog/category/view making numerous Redis/DB requests due to customizations
    recommendation: Request dev team to use Mage Profiler to identify bottlenecks. Leverage collections to reduce DB calls, reduce nested caching for Redis hits. For advanced profiling, use Xdebug or Blackfire
    internal_note: Add NewRelic links to bold words. Attach images if necessary. Send 'Leveraging the use of collections...' only if >8 DB calls/request in NewRelic

  deployment_issues:
    
    failed_cache_flush:
      problem: Redis refuses to flush cache during deployment due to high request volume
      solution:
        step_1: Identify Redis master - redis-cli -p 5000 SENTINEL get-master-addr-by-name mymaster
        step_2: Flush DB 1 (cache) on master - redis-cli -h <master_ip> -p <master_port> -n 1 FLUSHDB
      note: -n 1 flushes cache DB, leaves sessions (DB 0) untouched

standard_responses:
  
  justification_for_multiple_recommendations:
    trigger: Merchant complains about too many recommendations at once
    message: |
      Adobe Commerce Cloud operates under a shared responsibility model. Adobe ensures platform stability and provides performance-enhancing patches, but it's the merchant's responsibility to keep their Magento instance up-to-date (applying patches, best practices, configurations).
      
      Adobe doesn't enforce patches/recommendations immediately, allowing merchants flexibility. However, delaying these leads to accumulated inefficiencies (outdated configs, inefficient caching, increased data load) that manifest as severe performance issues when a critical threshold is reached.
      
      Needing many fixes now indicates best practices weren't consistently applied. E.g., Redis L2 cache (released since Magento 2.3) drastically reduces intra-node network load.
      
      We highly recommend proceeding with suggested patches/optimizations. If issues persist after, it helps isolate the root cause more effectively.
  
  redis_read_error:
    trigger: read error on connection to tcp://localhost:6370
    explanation: Redis refuses/times out connections due to being overwhelmed (too many simultaneous connections/operations). Culprit is usually third-party modules with excessive caching, concurrent with cron, API, cache flushes
    suggestion: Use profiling tools (Mage Profiler, Blackfire) to identify high load in transactions
    interim_actions:
      - Increase Redis timeout
      - Enable lazyfree operations
      - Enable stale cache
      - Split Redis for sessions
      - Enable pre-load keys
      - Disable block_html cache with Fastly soft purge
      - Apply relevant patches for caching
    note: AI tools should help identify problematic customizations in <15 mins
  
  nginx_worker_connections_not_enough:
    trigger: worker_connections are not enough
    explanation: Nginx reached max simultaneous connections per worker. Often co-occurs with '104 Connection reset by peer' (PHP worker closed connection without response - timeout, memory limit, fatal error)
    common_causes: Heavy traffic (bots, API), un-warmed cache. Third-party modules can slow PHP workers
    why_not_increase: Can worsen problem. More Nginx workers -> more requests to PHP-FPM -> surge in PHP processes -> CPU/memory pressure
    suggestion: Use profiling tools to pinpoint modules/code extending PHP processing times
    interim_actions:
      - Enable stale cache
      - Split Redis for sessions
      - Enable pre-load keys
      - Ensure Fastly soft purge enabled
  
  request_to_increase_php_workers:
    trigger: Merchant asks to increase PHP workers (pm.max_children)
    response: Not recommended, can cause severe side effects
    explanation: |
      Current config already pushes limits. Example: 38 workers * 6.2GB (4G PHP + 2G Opcache) = 235.6GB total potential RAM for PHP. 
      On a 246GB server, this leaves little headroom for MySQL, Redis, cron, system processes.
      
      Impact of upsize and more workers may shift bottleneck to database. Adobe Commerce Cloud uses Galera (multi-master) simulating master-slave. 
      More PHP workers might hit the same DB node -> contention, severe performance degradation.
    alternative: Optimize custom code to reduce memory/request, reduce PHP memory_limit where possible, minimize data processed per request. More sustainable than vertical scaling
  
  platform_ip_abuse_filtering:
    problem: Intermittent 503 'Service Unavailable' errors with consistent ~5-second timeout and connection drop, often affecting GraphQL requests in headless architectures
    root_cause: Secondary security layer at Platform.sh ingress level blocking requests from IPs with high abuse score on services like AbuseIPDB. Common in headless setups (Vercel, Netlify) where origin sees shared egress IPs
    investigation:
      - Confirm the ~5-second failure signature in New Relic or Fastly logs (10-second may indicate Fastly retry on GET)
      - Identify the 'client_ip' as seen by origin for failing requests
      - Check the IP's reputation on AbuseIPDB (score of 100 is strong indicator)
      - Note that this filter cannot be bypassed with custom application or VCL headers
    resolution: Cannot be resolved by merchant's developers. Requires escalation to Platform.sh team. Request to 'adjust the abusescore setting' for the specific cluster
    note: Recognizing the 5-second timeout signature is key to rapid escalation

