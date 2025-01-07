# Guidance for performance optimization

There are several issues that, at first glance, don't seem to be related, but when you do a deep analysis, the underlying problem is mostly the same: **Bad Performance**. The suggestions below should fix most of the issues related to:

- Outages
- Slowness
- Missed/failing cron jobs
- The majority of Redis issues
- Deadlocks
- Most indexers-related issues
- Slow queries, when actually the entire DB is slow and not a specific query.



The recommendations below are a "copy-paste template" that can be used to send to the merchant. Based on your investigation, you should judge what is relevant to send to the merchant. Always cross the information below with the findings in the [SWAT Report](https://supportinsights.adobe.com/commerce)** and [NewRelic](https://one.newrelic.com/).

Be aware that each bullet point is a different recommendation. **Don't copy and paste the suggestions below blindly. Do your analysis first and have a look at the articles about [Redis](https://wiki.corp.adobe.com/display/ACCS/Redis), [MariaDB](https://wiki.corp.adobe.com/display/ACCS/MariaDB) and others on this wiki.**

-----
***==>  One problem alone won't take down a server, but a chain of small issues, when aligned, can bring it to its knees. <==***


#### <a name="performancefreak-cacheflush"></a>**Cache Flush** 
- Avoid performing actions that flush the cache during business hours, as it causes a heavy impact on the overall performance.

Check in SWAT for "Dangerous actions". Also, use the Observation Tool to check the cache flushes, and also in NewRelic in Infrastructure > Third-party services > Redis




#### <a name="performancefreak-cacheable=false"></a>**Cacheable=false**
- There are pages not being cached. The reason is that there is a block with the flag cacheable=false. When this flag is present in a block, the entire page is not cacheable. To fix this, move non-cacheable blocks to a [private content mechanism](https://developer.adobe.com/commerce/php/development/cache/page/private-content/) instead.

Check the list of non-cached pages in SWAT. Follow a variation of this response when the cacheable false is in the file default.xml:

- There are pages not being cached. The reason is that there is a block with the flag cacheable=false. When this flag is present in a block, the entire page is not cacheable, but if it is present in the file default.xml, then the entire website is not cacheable. To fix this, move non-cacheable blocks to a [private content mechanism](https://developer.adobe.com/commerce/php/development/cache/page/private-content/) instead.
 


#### <a name="performancefreak-third-partymodules"></a>**Third-party modules**
- On the web side, I can see that the transaction **catalog/category/view**, for example, is performing a huge number of requests to Redis and the DB. I can see the customisations **aaa** and **bbb** on its stack trace, and they are contributing to the high load. Similar behaviour for the transaction **catalog/product/view** where we can see the customisations **xxx** and **yyy**. My suggestion here is to request your dev team to use the [Mage](https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/setup/mage-profiler)[Profile](https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/setup/mage-profiler)r to identify bottlenecks and points of improvement, reducing the load on the DB and Redis. Leveraging the use of collections can help reduce the number of calls to the DB, and reducing nested caching operations may reduce the number of hits to Redis. If your team needs more advanced profiling tools, they can use tools such as Xdebug or Blackfire, for example.

Add the NewRelic links to the **bold** words above and attach images if necessary. This part "Leveraging the use of collections..." should be sent to the merchant only if you see more than 8 calls to the DB per request in NewRelic.

 


#### <a name="performancefreak-l1andl2cachesizelimits"></a>**L1 and L2 cache size limits**
- You need to reduce the Redis max memory to 10 GB and reduce /dev/shm to 15 GB. This change can be done by our Platform team. Let me know if you want me to go ahead and request this change.

If Redis's maxmemory usage is low, please ignore this suggestion. If the merchant asks the reason, send:

This explains why the Redis maxmemory limit is 10Gb:

We recommend limiting Redis maxmemory to 10Gb and reducing the size of /dev/shm to 15Gb (10Gb for L2 cache matching Redis maxmemory size and an extra 50% for other services). Using more than these limits is problematic because Redis needs to keep the data in sync across all three nodes. However, this is network intensive as the sync is done over the network.

Suppose you have a 20Gb set for Redis, for example. You would theoretically need a network bandwidth of 160gbps to handle data synchronization in 1 second. If we change the configuration to allow synchronisations in 5 seconds, it would still require a network bandwidth of 32gbps to handle 20Gb of data, and yet, our highest-performing cluster is limited to 25gbps (assuming all this bandwidth could be dedicated to Redis, which is not feasible). So, even in this case, to sync 20Gb of data between the nodes, it would take approximately 6.4s in a perfect scenario.

This time is above the ideal limits, and Redis performance would be so degraded that there would be no point in using Redis. Not to mention that Redis Sentinel (the Redis service that monitors the nodes) could misinterpret the lengthy sync operation as a system crash. This could trigger failovers, "thinking" that the Redis master node has crashed instead of just syncing for this long. This could result in the master node being dropped in the middle of its sync operation, leading to a host of other side effects.

With Redis set to 10Gb, the sync would take around ~3.2s in a cluster with 25gbps and ~10s in a cluster limited to 8gbps. This in itself is still a long time for a sync operation, so to avoid more issues, we may need to increase the timeout when necessary (the default is 5s).

Our bandwidth limits: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-network-bandwidth.html>

But the big problem is not the bandwidth; it is the number of keys being generated and stored in Redis. This is often due to customisations, and using tools like New Relic, you should be able to identify the transaction creating this high number of keys. This should be the point of improvement. Usually, developers work on eliminating duplicate calls to Redis and removing recursive calls that hit the cache.

Additional Reasons for limiting Redis maxmemory to 10Gb:

1. Memory Pressure: High memory usage can lead to more frequent garbage collections or even out-of-memory errors, affecting system performance.
1. CPU Utilization: More data means more work for the CPU, which could affect the performance of other services running on the same machine.
1. Disk I/O: If Redis has to swap data to disk due to memory limitations, it can become I/O bound, affecting performance.
1. Network Congestion: A high rate of data sync could contribute to network congestion, affecting other services.

Although the suggestion above is valid in any situation, I usually send it when I see that /dev/shm usage is too high. I'd say the same of Redis usage or higher.




#### <a name="performancefreak-l2cache"></a>**L2 cache**
- Enable [Redis L2 cache](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/redis-service-configuration#configure-redis-l2-cache).

If the merchant asks how it works, send:

Redis L2 cache is an implementation that helps Magento to read the cache locally first and check the remote only if the local cache is not found. This drastically reduces the inter-node network traffic and improves the cache loading response time.

This is how it works:

When the Redis L2 cache is enabled, Magento will try to load the cache key from /dev/shm, which will act as L1. This is an in-memory mount point and is much faster as its access is local. If the cache key is not present in it, Magento tries to load the key from Redis, which will act as L2.

If the cache key is also not present in L2(Redis), then Magento stores the cache key in L2 first, then in L1(/dev/shm).

Next time Magento needs that key, it will get a hash from the key stored in L1 and compare it with the key in L2. If the hash is the same, Magento loads the key from L1, saving resources and reducing the load on the inter-node network, as it is a lot faster to read the cache key from local. If the hash is different, then Magento creates a new key in both L2 and L1.

Magento doesn’t have an eviction policy. The closest to it is when Magento flushes the cache when the L1 usage reaches 95% in 1 out of 1000 checks. But Redis does manage evictions.

That said, in situations of high load:

- If L2 maxmemory is bigger than L1 size, Magento can enter in a loop of generating the cache in L1, storing in L2 but quickly filling up L1, leading Magento to flush it, invalidating all keys in L2 as in the next verification, the hash will be different. This will cause severe performance degradation in the node where L1 was flushed first, and a chain reaction starts as Redis might sync this with the other nodes, also increasing the network traffic, which will cause other transactions to take longer to respond, affecting other services etc.

- If L1 size is bigger than L2 maxmemory, some issues also can happen. As explained, Magento doesn’t have an eviction policy, so L1 can end up full of expired keys, leading to 3 problems: 
  - Long time spent parsing the cache in L1
  - Memory fragmentation
  - Unnecessary resource usage

To prevent the issues described above, we came up with the idea of matching the size of L1 and L2. Let’s say L2 maxmemory is set to 10Gb, L1 should match this size, but since we don’t have control over the usage of this directory by other services, we decided to test leaving an extra 50%, which gives us 15Gb for L1.

L2 should contain the cache from all three nodes combined, but the nodes individually wouldn't necessarily have all the cache that is in L2.

Add this line below if the merchant doesn't have much traffic and /dev/shm usage is low:

In your specific case, the general cache usage is so low that you don't need to worry about reducing the size of /dev/shm just yet. However, there are a couple of other configurations you can apply for performance improvement:

Note: The configurations described above are not set by default when a server is provisioned because L2 cache is a new implementation.

The merchant can check how to do this by clicking on the link, but for your knowledge, this is how to enable it in .magento.env.yaml:

stage:

`  `deploy:

`    `REDIS\_BACKEND: '\Magento\Framework\Cache\Backend\RemoteSynchronizedCache'




#### <a name="performancefreak-redisslave"></a>**Redis Slave**
- Enable [Redis slave connection](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/redis-service-configuration#enable-redis-slave-connection)

**Do not** suggest this if the merchant is on a split architecture (More than three nodes). Example from the link to be applied in .magento.env.yaml

stage:

`  `deploy:

`    `REDIS\_USE\_SLAVE\_CONNECTION: true




#### <a name="performancefreak-mysqlslave"></a>**Mysql slave**
- Enable [Mysql Slave Connection](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/mysql-configuration#slave-connections)

Example from the link, apply to your .magento.env.yaml

stage:

`  `deploy:

`    `MYSQL\_USE\_SLAVE\_CONNECTION: true



#### <a name="performancefreak-redistimeout"></a>**Redis timeout**
- Increase Redis timeout by adding the configuration below to your .magento.env.yaml:

CACHE\_CONFIGURATION:

`        `\_merge: true

`        `frontend:

`          `default:

`            `backend\_options:

`              `read\_timeout: 10

`              `connect\_retries: 3

This also helps with issues where Redis is returning the error "Can not connect to localhost:6379." This is a common error when a large number of clients are performing requests to Redis, and it starts to refuse new connections. This is the case of a cache being flushed, for example, with customisations multiplying the number of caching operations. This situation is easy to spot in NewRelic.




#### <a name="performancefreak-stalecache"></a>**Stale cache**
- Enable[ stale cache](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/redis-service-configuration#enable-stale-cache) to help reduce the load on the database by serving expired cached data while new ones are being regenerated.

This also helps with issues where the server load is too high and crashes after cache flush. Example from the link above to be applied in .magento.env.yaml

stage:

`  `deploy:

`    `CACHE\_CONFIGURATION:

`      `\_merge: true

`      `default:

`        `backend\_options:

`          `use\_stale\_cache: false

`      `stale\_cache\_enabled:

`        `backend\_options:

`          `use\_stale\_cache: true

`      `type:

`        `default:

`          `frontend: "default"

`        `layout:

`          `frontend: "stale\_cache\_enabled"

`        `block\_html:

`          `frontend: "stale\_cache\_enabled"

`        `reflection:

`          `frontend: "stale\_cache\_enabled"

`        `config\_integration:

`          `frontend: "stale\_cache\_enabled"

`        `config\_integration\_api:

`          `frontend: "stale\_cache\_enabled"

`        `full\_page:

`          `frontend: "stale\_cache\_enabled"

`        `translate:

`          `frontend: "stale\_cache\_enabled"




#### <a name="performancefreak-pre-loadkeys"></a>**Pre-load keys**
- Enable [pre-load keys](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/redis-service-configuration#pre-load-keys).

You can get the list of top keys by monitoring active commands on Redis:

redis-cli -p 6370 -n 1 MONITOR > /tmp/list.keys

Press Ctrl+C after 10 seconds and analyze the log with the command below:

cat /tmp/list.keys| grep "HGET"| awk '{print $5}'|sort |uniq -c | sort -nr|head -n50

You can see the content of a key with the command:

redis-cli -p 6370 -n 1 hgetall "<key\_name>"

This also helps reduce the load on the web nodes. Example from the link above configured in .magento.env.yaml:

stage:

`  `deploy:

`    `CACHE\_CONFIGURATION:

`      `\_merge: true

`      `frontend:

`        `default:

`          `id\_prefix: '061\_'                       # Prefix for keys to be preloaded. It can be any random string

`          `backend\_options:

`            `preload\_keys:                         # List the keys to be preloaded

`              `- '061\_EAV\_ENTITY\_TYPES:hash'

`              `- '061\_GLOBAL\_PLUGIN\_LIST:hash'

`              `- '061\_DB\_IS\_UP\_TO\_DATE:hash'

`              `- '061\_SYSTEM\_DEFAULT:hash'

If the merchant asks for an explanation:

Magento normally fetches keys from Redis individually, which can add latency due to multiple network requests. By enabling the Redis preload feature, frequently used keys are fetched in bulk during initialization and stored in Magento's memory. This allows subsequent requests for these keys to be served directly from memory, reducing the need to query Redis repeatedly and improving overall performance.




#### <a name="performancefreak-parallelcachegeneration"></a>**Parallel cache generation**
- Enable Cache Parallel Generation to reduce the issues with lock contention and improve the performance under heavy load conditions:

bin/magento setup:config:set --allow-parallel-generation

This should help reduce the time taken to generate the cache and also reduce issues with lock contention, common in situations when Redis has high usage. Once activated, it is only possible to deactivate by removing the config from env.php.

**Tip**: When there is lock contention due to an excessive number of requests to Redis, you usually see in NewRelic an extended time on LockGuardedCacheLoader (Cache lock handler)




#### <a name="performancefreak-blockhtmlcache"></a>**Block HTML cache**
- To reduce the cache usage in Redis, I suggest you temporarily disable the Block Cache in Magento size, as it will be cached on the Fastly side. This action should be temporary until your dev team works on the customisations, reducing the number of hits to Redis and cache usage:

bin/magento cache:disable block\_html

I don't like suggesting this because most merchants never re-enable it, and keeping it disabled can increase the load on the server if the cache is purged on the Fastly side. Fastly Soft Purge and Enable Stale Cache should also be recommended.




#### <a name="performancefreak-keyscompression"></a>**Keys compression**
- You can compress the cache keys on Redis to help reduce memory usage. [Details here](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/redis-service-configuration#cache-compression).

Example from the link above applied in .magento.env.yaml

stage:

`  `deploy:

`    `CACHE\_CONFIGURATION:

`      `\_merge: true;

`      `frontend:

`        `default:

`          `backend\_options:

`            `compress\_data: 4              # 0-9

`            `compress\_tags: 4              # 0-9

`            `compress\_threshold: 20480     # don't compress files smaller than this value

`            `compression\_lib: 'gzip'       # snappy and lzf for performance, gzip for high compression (~69%)




#### <a name="performancefreak-splitredis"></a>**Split Redis**
- Save the sessions in a different Redis instance. This should help distribute the load and isolate the sessions from cache issues. The new instance should run on its own core, which should also improve performance. To do this, follow the steps [described here](https://experienceleague.adobe.com/en/docs/commerce-operations/implementation-playbook/best-practices/planning/redis-service-configuration#separate-redis-cache-and-session-instances).

This is for issues related to sessions or when Redis is reaching the maxmemory limit. The link above shows several steps as best practice, but the only configuration required is the example below to be applied in .magento.env.yaml. Of course, the Platform team must provision the new Redis instance first.

SESSION\_CONFIGURATION:

`  `\_merge: true

`  `redis:

`    `port: 6374       # check the port in $MAGENTO\_CLOUD\_RELATIONSHIPS

`    `timeout: 5

`    `disable\_locking: 1

`    `bot\_first\_lifetime: 60

`    `bot\_lifetime: 7200

`    `max\_lifetime: 2592000

`    `min\_lifetime: 60




#### <a name="performancefreak-patches"></a>**Patches**
- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply the patch **B2B-2674 to a**dd caching capability to the customAttributeMetadata GraphQL query and **B2B-2598** to add caching capability to the availableStores, countries, country, currency, and storeConfig GraphQL queries.

This suggestion is very effective in headless architecture with a high volume of GraphQL requests.

**Merged on Magento 2.4.7**

- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply the patch **MCLOUD-11514** to optimize the layout cache, which should also reduce the load on the server after a cache flush.

This suggestion is to optimize the data retrieval from Redis, improving the performance. On-premisses use ACSD-56624\_2.4.6-p3.patch attached.

**Merged on Magento 2.4.7**

- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply the patch **MCLOUD-11329** to fix an issue where missed jobs unnecessarily wait for cron job locks, which can lead to lock contention and unnecessary resource consumption.

**Merged on Magento 2.4.7**

- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply the patch **ACSD-53583** to Improve the partial reindex performance for "Category Products" and "Product Categories" indexers.

**Merged on Magento 2.4.7 - Do not** install if you have **Live Search**!!!! For merchants **with** **LiveSearch,** please apply [ACSD-55719](https://jira.corp.adobe.com/browse/ACSD-55719 "[Magento Cloud] Deployment fails when applying patch ACSD-53583") (Up to Magento 2.4.3-p3) - Not available in the quality patch

- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply the patch **ACSD-56415** to fix an issue where the performance of the partial price indexing is slowed down due to a DELETE query when the database has a lot of partial price data to index.

**Merged on Magento 2.4.7**

- Apply the patch [**ACSD-56226_2.4.6-p2.patch](file:///C:/download/attachments/3234969246/ACSD-56226_2.4.6-p2.patch?version=2&modificationDate=1721067391690&api=v2)** attached to fix an issue that was causing performance degradation with synchronous replication, which should be set to **true** to ensure data consistency.

**Merged on Magento 2.4.7**

- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply the patch **ACSD-58739** to convert temp tables to physical tables during the reindex. This will reduce memory usage, prevent issues with resource contention, and prevent errors like “Base table or view not found.”

This is for **Magento 2.4.7**+ only.

- Apply the patch[**ACSD-60549_2.4.4-p8.patch**](file:///C:/download/attachments/3234969246/ACSD-60549_2.4.4-p8.patch?version=1&modificationDate=1733142277247&api=v2) to optimize indexing operations by introducing a No DDL Mode. This significantly reduces database load and prevents node desynchronization by avoiding table recreations during reindexing, using efficient table switching instead. This patch is particularly effective for environments experiencing indexer-related slowdowns, deadlocks, or database node sync issues.

This is for **Magento 2.4.4** only

- Use the [Quality Patch Tool](https://experienceleague.adobe.com/tools/commerce-quality-patches/index.html) to apply patch **ACSD-62577** to optimize search query performance by restructuring database indexes and improving SQL queries. The patch disables inefficient indexes and adds new compound indexes that include num\_results and popularity columns, while also improving query specificity with proper table prefixes.

This is for **all Magento versions**, for merchants with slowness on **search**.




#### <a name="performancefreak-softpurgeonfastly"></a>**Soft purge on Fastly**
- Enable soft-purge for CMS and Category page on the Fastly side with the command below:

bin/magento config:set system/full\_page\_cache/fastly/fastly\_advanced\_configuration/soft\_purge 1

bin/magento config:set system/full\_page\_cache/fastly/fastly\_advanced\_configuration/preserve\_static 1

bin/magento config:set system/full\_page\_cache/fastly/fastly\_advanced\_configuration/purge\_cms\_page 1

bin/magento config:set system/full\_page\_cache/fastly/fastly\_advanced\_configuration/purge\_catalog\_category 1

Check the SWAT Report for more details




#### <a name="performancefreak-phpmemory"></a>**PHP memory**
- In your php.ini, increase memory\_limit, realpath\_cache\_size and opcache.memory\_consumption to:

memory\_limit = 2G

realpath\_cache\_size = 10M

opcache.memory\_consumption=2048




#### <a name="performancefreak-op-cache"></a>**OP-Cache**
- Make sure your op-cache is properly configured by adding the lines below to your php.ini:

;

; Setup opcache configuration

;

opcache.validate\_timestamps = 0

opcache.blacklist\_filename="${MAGENTO\_CLOUD\_APP\_DIR}/op-exclude.txt"

opcache.max\_accelerated\_files=16229

opcache.consistency\_checks=0



- Make sure your file op-exclude.txt has all [those six lines](https://github.com/magento/magento-cloud/blob/master/op-exclude.txt) to prevent the configurations from being cached at the op-cache level, which could cause inconsistencies when the config is changed.

This helps with issues where cron is being disabled automatically or other configurations are being changed without human intervention. It could be due to opcache.




#### <a name="performancefreak-third-partycronjobs"></a>**Third-party cron jobs**
- Remove all third-party cron tasks from the group default and add them to their own group, then enable the option "[Use Separate Process](https://experienceleague.adobe.com/en/docs/commerce-admin/systems/tools/cron)".

**I consider this one of the most important recommendations together use\_application\_lock.** This helps with most issues related to cron jobs and indexing failing caused by lock contentions and resource constraints when multiple cron jobs overlap each other. This is a very common cause of **indexer\_reindex\_all\_views** failures, for example, as the group default runs in parallel with the group indexer, so when the group default takes too long to be executed, it can affect the indexers.




#### <a name="performancefreak-applicationlock"></a>**Application Lock**
- Enable "[Use Application Lock](https://developer.adobe.com/commerce/php/development/components/indexing/#using-application-lock-mode-for-reindex-processes)" to prevent multiple indexing processes from trying to run simultaneously and ensure proper cleanup of interrupted indexers. For this, add to your .magento.app.yaml:

variables:

`    `env:

`        `MAGENTO\_DC\_INDEXER\_\_USE\_APPLICATION\_LOCK: true

For on-prem, config in env.php:

<?php

return [

`    `'indexer' => [

`        `'use\_application\_lock' => true

`    `]

];




#### <a name="performancefreak-parallelreindex"></a>**Parallel reindex**
- Improve the indexing performance by [enabling parallel indexing](https://experienceleague.adobe.com/en/docs/commerce-operations/configuration-guide/cli/manage-indexers#reindexing-in-parallel-mode). In your .magento.app.yaml, add the following variable:

variables:

`  `env:

`      `MAGE\_INDEXER\_THREADS\_COUNT: 8 # The maximum value allowed should be smaller than the result of the command 'nproc', or the indexing process might endup consuming all the server resources. Values higher than 8 don't show any extra improvement.

In my personal tests, some indexers got faster and others slower, but the total indexing time was up to 53% faster. The performance gain varies from case to case.




#### <a name="performancefreak-dimensionmode"></a>**Dimension mode**
- I recommend implementing dimension-based indexing for product prices. Instead of processing all price data in one large table, it splits the data into smaller, more manageable chunks based on websites and customer groups. This increases the disk and CPU usage but reduces memory usage per operation during the price indexing, preventing issues with other indexers. For this, just execute the command below:

bin/magento indexer:set-dimensions-mode catalog\_product\_price website\_and\_customer\_group



#### <a name="performancefreak-indexbatchsize"></a>**Index Batch Size**
- [Configure the batch size settings for indexers](https://developer.adobe.com/commerce/php/development/components/indexing/optimization/#batching-configuration) to optimize memory usage and prevent issues with resource contention.
1. You can reduce these values when the server has limited memory resources, complex product structures with many attributes and frequent indexing failures, but the indexer might take longer.
1. You can increase those values when indexing operations are taking too long and your server has plenty of available memory. Be aware that increasing the values below will increase the usage of **max\_heap\_table\_size** and **tmp\_table\_size**. If their usage exceeds 20% of the **innodb\_buffer\_pool\_size**, you might get the error: "Memory size allocated for the temporary table is more than 20% of **innodb\_buffer\_pool\_size**." The fix is simply reducing the batch size or increasing **innodb\_buffer\_pool\_size**. The values shown below are balanced starting points, but the optimal values depend on your specific catalog size, server resources, and indexing patterns.
   You can configure this by adding the variables below into your .magento.**app**.yaml:

variables:

`    `env:

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOGINVENTORY\_STOCK\_\_SIMPLE: 200

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOG\_CATEGORY\_PRODUCT: 666

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOGSEARCH\_FULLTEXT\_\_PARTIAL\_REINDEX: 100

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOGSEARCH\_FULLTEXT\_\_MYSQL\_GET: 500

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOGSEARCH\_FULLTEXT\_\_ELASTIC\_SAVE: 500

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOG\_PRODUCT\_PRICE\_\_SIMPLE: 200

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOG\_PRODUCT\_PRICE\_\_DEFAULT: 500

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOG\_PRODUCT\_PRICE\_\_CONFIGURABLE: 666

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_CATALOGPERMISSIONS\_CATEGORY: 999

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_INVENTORY\_\_SIMPLE: 210

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_INVENTORY\_\_DEFAULT: 510

`        `MAGENTO\_INDEXER\_BATCH\_SIZE\_\_INVENTORY\_\_CONFIGURABLE: 616




#### <a name="performancefreak-forcereindex"></a>**Force reindex**
- Force a full reindex:

php vendor/bin/ece-tools cron:kill; php vendor/bin/ece-tools cron:unlock; vendor/bin/ece-tools cron:disable; php bin/magento indexer:info | awk '{print $1}' | xargs -I {} bash -c 'php bin/magento indexer:reset {} && php bin/magento indexer:reindex {}' && vendor/bin/ece-tools cron:enable; 

This is for situations when several indexers are stuck with a big backlog, a common problem when the Platform team needs to restart some node or some process is killed. This will reindex all indexers. Most of the time, I'd rather suggest reindexing only the specific stuck indexer with the command:

MAGE\_INDEXER\_THREADS\_COUNT=4 bin/magento indexer:reset <indexer\_name> && php -d memory\_limit=-1 bin/magento indexer:reindex <indexer\_name>




#### <a name="performancefreak-tablecardinality"></a>**Table cardinality**
- When there are significant changes in the DB, usually by DDL or DML queries, those changes can affect how well the database server understands the data distribution within these tables. The DB engine relies on statistical information about the data, known as table statistics or cardinality, to create efficient query execution plans. If these statistics become outdated or inaccurate, the server chooses suboptimal execution plans, leading to severe performance degradation. You can execute the command below to update the statistics for all tables in the entire DB. This is to ensure the DB has the latest information for optimizing query execution:

mysqlcheck -h<host\_name> -u<user\_name> -p -a <db\_name>

This command may cause a lock on the tables, so it is recommended to execute it with the cron disabled and out of business hours. It rarely takes over a minute to finish and should be executed at least once a month as part of your housekeeping.

This suggestion fixes most of the issues related to bad query performance as the table statistics are regenerated. If the merchant asks more details, send:

- When a DDL query is performed, depending on the size of the table, the DB engine may use the algorithm COPY, especially when executing ALTER TABLE, which means that a new table will be created with the new changes and the data transferred. However, the table statistics are not something that can be copied. They need to be regenerated using ANALYZE TABLE. If not, the query execution plan will be very poor, leading to significant performance degradation on the queries. If you execute ANALYZE TABLE and no change is visible in performance, it means that the table statistics were already optimal and the performance degradation in the server is caused by something else. This command should also be executed regularly or each time over 30% of a table is changed to ensure that the table statistics accurately represent the current table status.

In case you want to run the command yourself, use this:

mysqlcheck -h$(echo $MAGENTO\_CLOUD\_RELATIONSHIPS | base64 -d | jq -r .database[0].host) -u$(echo $MAGENTO\_CLOUD\_RELATIONSHIPS | base64 -d | jq -r .database[0].username) -p$(echo $MAGENTO\_CLOUD\_RELATIONSHIPS | base64 -d | jq -r .database[0].password) -a $(echo $MAGENTO\_CLOUD\_RELATIONSHIPS | base64 -d | jq -r .database[0].path)




#### <a name="performancefreak-largetables"></a>**Large tables**
- The following table is too large, more than 1 GB, and must be reduced. This can lead to performance degradation, so I suggest you truncate this table. Perform a backup first and check with your dev team if the information on it is still relevant:

<Copy the table with the tables name from SWAT Report>




#### <a name="performancefreak-triggers"></a>**Triggers**
- I can see you use triggers in MySQL. The problem with triggers is that they are interpreted, not pre-compiled, causing each query to add parsing and interpreting overhead on the DB. Since triggers and queries share the same transaction space, they compete for locks on the tables, adding further overhead and affecting the DB performance. Consider moving the triggers below to code:

<Copy the table with the triggers name from SWAT Report>




#### <a name="performancefreak-failedcacheflush"></a>**Failed cache flush**
- Just before the deployment, send the cache flush command straight to the Redis master node following these steps:

1\. Ask Redis Sentinel who exactly is the current master by running:

redis-cli -p 5000 SENTINEL get-master-addr-by-name mymaster

You should see a result like this example:

\1) "192\.168\.7\.7"

\2) "26370"

2\. Then perform the command you want against the Master, for example:

redis-cli -h 192.168.7.7 -p 26370 -n 1 FLUSHDB

**Please note** that “-n 1” means that I’m flushing only the DB 1, which is the one used for cache, so the sessions (DB 0) remain untouched

This is for issues during the deployment when Redis refuses to flush the cache due to the high number of requests hitting Redis, a common situation when customisations are multiplying the number of hits to DB and Redis.




#### <a name="performancefreak-jsandcssminification"></a>**JS and CSS minification**
- Enable JS and CSS minification. For this, run the command locally:

bin/magento config:set --lock-config dev/js/minify\_files 1

bin/magento config:set --lock-config dev/css/minify\_files 1

Then, commit the changes to the file app/etc/config.php and trigger a new deployment. Check [the documentation](https://experienceleague.adobe.com/en/docs/commerce-admin/systems/tools/developer-tools#optimizing-resource-files) for more details.

This is for front-end performance optimisation. Check it in SWAT





-----
**If you are a Performance Freak, go with the recommendations below as well:**


#### <a name="performancefreak-redisasynchronous"></a>**Redis Asynchronous**
- We can request our Platform team to apply the configs below to minimize the latency and enhance the throughput, improving Redis response time by making some operations asynchronous. Let us know if you want us to go ahead with this change:

Lazyfree-lazy-eviction yes

lazyfree-lazy-expire yes

lazyfree-lazy-server-del yes

replica-lazy-flush yes

lazyfree-lazy-user-del yes

This also helps with issues where Redis is returning the error "Can not connect to localhost:6379", but I only suggest this when all the other options are still not helping. The reason is that it increases Redis memory consumption.

Never suggest this if the merchant is having issues with High Redis memory usage.




#### <a name="performancefreak-tablefragmentation"></a>**Table fragmentation**
- Run the command below to optimize all tables. Note that this is a more aggressive command, and it may take longer to finish than the "Analyze table". This is to find and fix issues with table fragmentation, which can compromise the DB performance.  I suggest you to perform a full DB backup first:

mysqlcheck -h<host\_name> -u<user\_name> -p -o <db\_name>

This command may cause a lock on the tables, so it is recommended to execute it with the cron disabled and out of business hours.




#### <a name="performancefreak-querycache"></a>**Query cache**
- Query cache is a feature that stores the result set of SELECT queries. This speeds up response times for queries that are executed frequently and is especially beneficial in scenarios where the database data does not change often. However, In a Galera environment, each node is a master, and data modifications on one node are replicated to all other nodes. The query cache, being local to each node, can lead to inconsistencies as different nodes might have different cached data, leading to non-uniform query responses. Also, maintaining the cache in sync across the nodes can add overhead, affecting the overall DB performance, particularly in write-heavy environments.

That said, in Galera Cluster setups, it's generally advised to disable the query cache to ensure consistency and optimal performance, but yet, we see different results for different merchants, in some cases disabling the query cache caused performance degradation and in other cases, performance improvements. 

So, the query cache is treated on a case by case, and to help with the decision, you can use the query below:

SELECT

`    `ROUND(QV.query\_cache\_size / (1024 \* 1024), 2) AS 'Current Cache Size (MB)',

`    `CONCAT(ROUND((1 - (QS.Qcache\_free\_memory / QV.query\_cache\_size)) \* 100, 2), '%') AS 'Cache Usage (%)',

`    `CONCAT(ROUND((QS.Qcache\_hits / (QS.Qcache\_hits + QS.Qcache\_inserts + QS.Qcache\_not\_cached)) \* 100, 2), '%') AS 'Cache Hit Ratio (%)',

`    `QS.Qcache\_lowmem\_prunes AS 'Low Memory Prunes',

`    `CASE

`        `WHEN (QS.Qcache\_lowmem\_prunes > 50)

`             `AND ((1 - (QS.Qcache\_free\_memory / QV.query\_cache\_size)) > 0.9)

`             `AND ((QS.Qcache\_hits / (QS.Qcache\_hits + QS.Qcache\_inserts + QS.Qcache\_not\_cached)) > 0.5)

`            `THEN CONCAT('Increase query\_cache\_size to ', ROUND(LEAST(QV.query\_cache\_size \* 2, 512 \* 1024 \* 1024) / (1024 \* 1024), 0), ' MB')

`        `WHEN ((1 - (QS.Qcache\_free\_memory / QV.query\_cache\_size)) < 0.25)

`             `OR ((QS.Qcache\_hits / (QS.Qcache\_hits + QS.Qcache\_inserts + QS.Qcache\_not\_cached)) < 0.2)

`            `THEN CONCAT('Decrease query\_cache\_size to ', ROUND(GREATEST(QV.query\_cache\_size / 2, 1 \* 1024 \* 1024) / (1024 \* 1024), 0), ' MB')

`        `ELSE 'Keep the current query\_cache\_size'

`    `END AS 'Suggestion'

FROM

`    `(SELECT

`        `SUM(CASE WHEN VARIABLE\_NAME = 'Qcache\_hits' THEN VARIABLE\_VALUE ELSE 0 END) AS Qcache\_hits,

`        `SUM(CASE WHEN VARIABLE\_NAME = 'Qcache\_inserts' THEN VARIABLE\_VALUE ELSE 0 END) AS Qcache\_inserts,

`        `SUM(CASE WHEN VARIABLE\_NAME = 'Qcache\_not\_cached' THEN VARIABLE\_VALUE ELSE 0 END) AS Qcache\_not\_cached,

`        `SUM(CASE WHEN VARIABLE\_NAME = 'Qcache\_free\_memory' THEN VARIABLE\_VALUE ELSE 0 END) AS Qcache\_free\_memory,

`        `SUM(CASE WHEN VARIABLE\_NAME = 'Qcache\_lowmem\_prunes' THEN VARIABLE\_VALUE ELSE 0 END) AS Qcache\_lowmem\_prunes

`     `FROM information\_schema.GLOBAL\_STATUS

`     `WHERE VARIABLE\_NAME IN ('Qcache\_hits', 'Qcache\_inserts', 'Qcache\_not\_cached', 'Qcache\_free\_memory', 'Qcache\_lowmem\_prunes')

`    `) AS QS,

`    `(SELECT VARIABLE\_VALUE AS query\_cache\_size FROM information\_schema.GLOBAL\_VARIABLES WHERE VARIABLE\_NAME = 'query\_cache\_size') AS QV;

The query above should display the cache hit ratio and the cache usage percentage. If they are too low, it is just more efficient to disable the query cache by setting its value to 0. This query should also show the recommended query cache size based on the query cache usage.

By default, all our merchants have the query cache set to 256 MB, but in some cases, we reduced it to just 16MB or even disabled it.

To see the current query cache size, just run:

SELECT variable\_value / 1024 / 1024 AS query\_cache\_size\_in\_MB

FROM information\_schema.global\_variables

WHERE variable\_name = 'query\_cache\_size';

This change is performed by our Platform team. Please let me know if you want me to request them to change it and what value you would like to change.




#### <a name="performancefreak-innodbbufferpool"></a>**InnoDB Buffer Pool**
- The InnoDB Buffer Pool is a memory area in MariaDB for caching data and indexes of InnoDB tables. Its purpose is to reduce disk I/O by keeping frequently accessed data in memory, leading to faster query responses. To find out the ideal size for **innodb\_buffer\_pool\_size**, you can run the query below. This calculation is based on the common recommendation that the InnoDB buffer pool should be sized to approximately 80% of your total dataset size. Of course, you need to have enough RAM for it:

SELECT CONCAT(CEILING(Total\_InnoDB\_Bytes\*0.8/POWER(1024,3)), ' GB') AS Recommended FROM

(SELECT SUM(data\_length+index\_length) Total\_InnoDB\_Bytes

FROM information\_schema.tables WHERE engine='InnoDB') A;

This change is performed by our Platform team. Please let me know if you want me to request them to change it.




#### <a name="performancefreak-sequentialcronjobs"></a>**Sequential cron jobs**
- Configure the cron to run the cron jobs sequentially instead of in parallel. Just add this to your .magento.app.yaml file:

crons:

`    `magento:

`        `spec: "\* \* \* \* \*"

`        `cmd: bash -c 'for group in $(grep -shoP "(?<=<group id=\")(.+)(?=\">)" {app,vendor}/\*/\*/etc/cron\_groups.xml); do echo -n Running cron group ${group} --- && php -d memory\_limit=-1 bin/magento cron:run --group=${group}; done'

I've recommended this a couple of times for **Starter Accounts** to fix issues related to resource constraints, common when they can't even run a full reindex without crashing for lack of resources. I have never sent this suggestion to **Pro Acounts**, and there are so many other ways of improving the server performance that if it gets to the point of suggesting this, I'd rather **recommend an upsize**.


