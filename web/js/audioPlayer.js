// 完全重写的AudioPlayer类
// 确保没有任何可能导致播放速度变快的问题

class AudioPlayer {
    constructor() {
        try {
            console.log('AudioPlayer构造函数开始执行');
            this.audioElement = new Audio();
            console.log('创建audioElement:', this.audioElement);
            this.currentChannelIndex = 0;
            this.currentCategoryIndex = 0;
            this.currentItemIndex = 0;
            this.isPlaying = false;
            console.log('初始化属性完成');
            
            this.audioData = this.loadAudioList();
            console.log('加载音频数据完成:', this.audioData);
            
            this.setupEventListeners();
            console.log('设置事件监听器完成');
            
            // 延迟调用fetchFromCloud，确保DOM元素完全加载
            setTimeout(() => {
                console.log('调用fetchFromCloud');
                this.fetchFromCloud();
                console.log('fetchFromCloud调用完成');
            }, 1000); // 增加延迟时间，确保DOM元素完全加载
            
            console.log('AudioPlayer构造函数执行完成');
        } catch (error) {
            console.error('AudioPlayer构造函数执行失败:', error);
        }
    }

    loadAudioList() {
        // 默认返回空数据，实际数据将通过fetchFromCloud方法从云侧获取
        return {
            channels: []
        };
    }

    // 将下游服务响应转换为前端内部的 channels 结构
    // 顶层: channels = [{ name: '新闻资讯', categories: [...] }, { name: '播客', categories: [...] }]
    // 每个 category: { name: '时政', items: [...] }
    transformDownstreamData(data) {
        const channels = [];

        if (data.news && Array.isArray(data.news) && data.news.length > 0) {
            channels.push({
                name: '新闻资讯',
                categories: data.news.map(cat => ({
                    name: cat.category || '',
                    items: cat.items || []
                }))
            });
        }

        if (data.podcasts && Array.isArray(data.podcasts) && data.podcasts.length > 0) {
            channels.push({
                name: '播客',
                categories: data.podcasts.map(cat => ({
                    name: cat.category || '',
                    items: cat.items || []
                }))
            });
        }

        return { channels };
    }

    // 生成唯一的 sessionId
    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    }

    // 从云侧获取音频数据
    // 带 query 参数请求云侧数据
    async fetchFromCloudWithQuery(query) {
        await this._fetchData(query);
    }

    async fetchFromCloud() {
        await this._fetchData('');
    }

    async _fetchData(query) {
        try {
            console.log('从云侧获取音频数据, query:', query);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            if (!this.sessionId) {
                this.sessionId = this.generateSessionId();
            }

            const response = await fetch('/api/audio-data', {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ sessionId: this.sessionId, query: query })
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('从云侧获取音频数据成功:', data);

            this.audioData = this.transformDownstreamData(data);

            if (this.audioData && this.audioData.channels && this.audioData.channels.length > 0) {
                this.updatePlaylistUI();
                this.playAudio(0, 0, 0);
            } else {
                console.error('audioData没有数据');
                if (!query) this.useLocalFallbackData();
            }
        } catch (error) {
            console.error('从云侧获取音频数据失败:', error);
            this.useLocalFallbackData();
        }
    }
    
    // 使用本地备用数据（已适配下游服务字段格式）
    useLocalFallbackData() {
        console.log('使用本地备用数据');
        this.audioData = {
            channels: [
                {
                    name: '新闻资讯',
                    categories: [
                        {
                            name: '时政',
                            items: [
                                { docId: 'n1', title: '国务院常务会议部署2026年经济工作重点', siteName: '新华社', image: '', content: '国务院总理主持召开国务院常务会议，研究部署2026年经济工作重点任务。会议指出，要坚持稳中求进工作总基调，完整、准确、全面贯彻新发展理念。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n2', title: '两会闭幕：政府工作报告要点回顾', siteName: '人民日报', image: '', content: '全国两会圆满闭幕。今年政府工作报告提出，2026年国内生产总值增长目标为5.5%左右，城镇新增就业1200万人以上。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n3', title: '中美元首通话讨论双边经贸合作', siteName: '央视新闻', image: '', content: '中美两国元首举行视频通话，就双边关系和共同关心的国际地区问题交换了意见。双方同意加强在气候变化、公共卫生等领域的合作。', publishTime: '2026-04-06', aiStatement: '' },
                                { docId: 'n4', title: '全国碳排放权交易市场年度报告发布', siteName: '经济日报', image: '', content: '生态环境部发布全国碳排放权交易市场2025年度报告，碳市场累计成交量突破5亿吨，交易总额超过200亿元。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '科技',
                            items: [
                                { docId: 'n5', title: '量子计算领域取得重大突破', siteName: '科技日报', image: '', content: '中国科学院宣布成功构建66比特量子计算原型机"天衡二号"，在特定任务上的计算速度比经典超级计算机快1亿倍。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n6', title: '国产大飞机C919累计交付突破100架', siteName: '新华社', image: '', content: '中国商飞公司宣布C919累计交付突破100架，已开通国内航线超过50条，安全性和经济性获得高度认可。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n7', title: 'AI大模型在医疗领域实现突破性应用', siteName: '环球科学', image: '', content: 'AI大模型辅助诊断系统在肺癌早期筛查中的准确率达到97.3%，已在全国200多家三甲医院投入使用。', publishTime: '2026-04-06', aiStatement: '' },
                                { docId: 'n8', title: '我国成功发射新一代北斗导航卫星', siteName: '中国航天报', image: '', content: '新一代北斗导航卫星成功发射，将进一步提升北斗系统的定位精度，民用定位精度可达厘米级。', publishTime: '2026-04-05', aiStatement: '' },
                                { docId: 'n9', title: '全球首款固态电池量产车型在中国下线', siteName: '第一财经', image: '', content: '全球首款搭载固态电池的量产纯电动汽车下线，续航超1200公里，充电15分钟补充600公里。', publishTime: '2026-04-04', aiStatement: '' }
                            ]
                        },
                        {
                            name: '财经',
                            items: [
                                { docId: 'n10', title: 'A股三大指数集体收涨 成交额突破万亿', siteName: '证券时报', image: '', content: 'A股三大指数集体收涨，上证指数涨1.2%报收3856点，两市成交额达1.2万亿元，北向资金净流入超150亿元。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n11', title: '央行宣布定向降准0.5个百分点', siteName: '中国人民银行', image: '', content: '央行对中小银行实施定向降准0.5个百分点，释放长期资金约8000亿元，支持实体经济发展。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n12', title: '人民币汇率创近两年新高', siteName: '财新网', image: '', content: '在岸人民币对美元汇率升破6.65关口创近两年新高，得益于经济基本面向好及外资持续流入。', publishTime: '2026-04-06', aiStatement: '' },
                                { docId: 'n13', title: '新能源产业投资额同比增长45%', siteName: '21世纪经济报道', image: '', content: '2026年一季度新能源产业投资额同比增长45%，光伏、风电和储能三大赛道均呈高速增长态势。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '娱乐',
                            items: [
                                { docId: 'n14', title: '《流浪地球3》全球票房突破80亿', siteName: '猫眼电影', image: '', content: '科幻电影《流浪地球3》全球票房突破80亿人民币，成为中国影史票房冠军，首部北美票房破2亿美元的中国电影。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n15', title: '第45届香港电影金像奖揭晓', siteName: '南方都市报', image: '', content: '第45届金像奖最佳影片由《风再起时》获得，最佳导演由陈可辛凭《独行月球2》摘得。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n16', title: '国产动画《大圣归来2》定档暑期', siteName: '时光网', image: '', content: '国产动画电影《大圣归来2》定档2026年暑期档，延续热血风格讲述孙悟空对抗天庭危机的故事。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '体育',
                            items: [
                                { docId: 'n17', title: '世预赛：中国队2-1韩国 武磊梅开二度', siteName: '体坛周报', image: '', content: '世界杯预选赛亚洲区12强赛，中国队主场2比1战胜韩国队，武磊梅开二度，国足暂列小组第三。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n18', title: 'NBA常规赛收官：东西部排名出炉', siteName: 'ESPN中文', image: '', content: 'NBA常规赛收官，东部前三凯尔特人、雄鹿、76人，西部前三掘金、雷霆、独行侠。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n19', title: '中国游泳队世锦赛获历史最佳', siteName: '新体育', image: '', content: '世界游泳锦标赛中国队获8金5银3铜创历史最佳，覃海洋男子200米蛙泳打破世界纪录。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '国际',
                            items: [
                                { docId: 'n20', title: '联合国通过全球数字治理框架', siteName: '参考消息', image: '', content: '联合国大会通过《全球数字治理框架》，为人工智能、数据安全和数字经济建立国际规则体系。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n21', title: '欧盟碳边境调节机制正式生效', siteName: '环球时报', image: '', content: '欧盟碳边境调节机制（CBAM）正式生效，对进口钢铁、铝、水泥等产品征收碳关税。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n22', title: '东盟峰会聚焦区域经济一体化', siteName: '国际在线', image: '', content: '东盟峰会在雅加达召开，各成员国就加强区域经济一体化、推动数字经济合作达成多项共识。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '社会',
                            items: [
                                { docId: 'n23', title: '全国高考改革方案正式公布', siteName: '中国教育报', image: '', content: '教育部公布新高考改革方案，2027年起全面推行"3+1+2"模式，增加综合素质评价权重。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n24', title: '城市轨道交通里程突破1.2万公里', siteName: '中国交通报', image: '', content: '全国城市轨道交通运营里程突破1.2万公里，覆盖55个城市，日均客运量超过8000万人次。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n25', title: '我国人均预期寿命达79.2岁', siteName: '健康报', image: '', content: '国家卫健委发布报告，我国人均预期寿命已达79.2岁，主要健康指标居于中高收入国家前列。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '汽车',
                            items: [
                                { docId: 'n26', title: '3月新能源汽车销量突破120万辆', siteName: '汽车之家', image: '', content: '3月份新能源汽车销量达到120万辆，渗透率首次突破55%，比亚迪、特斯拉、小米位列前三。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n27', title: '小米汽车SU7年交付量突破30万', siteName: '36氪', image: '', content: '小米汽车SU7上市一年累计交付突破30万辆，成为新势力品牌中增速最快的车型。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n28', title: '自动驾驶商用政策在15城试点', siteName: '经济观察报', image: '', content: '交通运输部宣布自动驾驶商用化运营在北京、上海等15个城市开展试点，覆盖出租车和货运场景。', publishTime: '2026-04-06', aiStatement: '' },
                                { docId: 'n29', title: '充电桩保有量突破800万个', siteName: '中国能源报', image: '', content: '全国充电基础设施保有量突破800万个，车桩比降至2:1，高速公路充电网络实现全覆盖。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '健康',
                            items: [
                                { docId: 'n30', title: '国产阿尔茨海默病新药获批上市', siteName: '医学界', image: '', content: '国产阿尔茨海默病创新药"忆清"获批上市，临床试验显示可有效延缓认知功能下降，填补国内空白。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n31', title: '春季过敏高发 专家支招预防', siteName: '健康时报', image: '', content: '春季花粉过敏进入高发期，专家建议外出佩戴口罩、减少户外活动时间，必要时提前服用抗过敏药物。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n32', title: '全国三甲医院全面推行电子病历', siteName: '人民健康', image: '', content: '全国三甲医院已全面推行电子病历系统，实现跨院查阅和数据共享，患者就医更加便捷。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '文化',
                            items: [
                                { docId: 'n33', title: '三星堆新出土文物首次公开展出', siteName: '光明日报', image: '', content: '三星堆遗址最新发掘出土的青铜神树、金面具等珍贵文物在四川省博物馆首次公开展出，吸引大量观众。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'n34', title: '首届全球华语文学奖在京颁发', siteName: '文艺报', image: '', content: '首届全球华语文学奖在北京颁发，来自中国大陆、台湾、香港及海外的12位作家获奖。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'n35', title: '故宫数字化项目实现全景VR漫游', siteName: '中国文化报', image: '', content: '故宫博物院数字化项目全面完成，公众可通过VR设备足不出户实现全景漫游，覆盖所有开放区域。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        }
                    ]
                },
                {
                    name: '播客',
                    categories: [
                        {
                            name: '今日大事',
                            items: [
                                { docId: 'p1', title: '今日要闻速览：经济数据与政策解读', siteName: '每日播客', image: '', content: '欢迎收听今日大事播客，聊聊最新经济数据以及对政策走向的解读，一季度GDP增速超预期。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p2', title: '国际局势周报：全球热点一览', siteName: '每日播客', image: '', content: '本周国际局势要点回顾。欧盟通过新一轮对外贸易协定，中东和平进程取得积极进展。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p3', title: '两会特别节目：民生政策深度解析', siteName: '每日播客', image: '', content: '两会期间出台的民生政策深度解析，从医疗改革到教育公平，全方位解读政策变化。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '深度访谈',
                            items: [
                                { docId: 'p4', title: '对话AI科学家：大模型的未来在哪里', siteName: '36氪播客', image: '', content: '本期邀请国内顶尖AI科学家，探讨大语言模型的发展方向，从多模态到具身智能。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p5', title: '创业者说：从0到1的真实故事', siteName: '36氪播客', image: '', content: '一位连续创业者分享三次创业经历，从失败中学习，最终打造估值超百亿的独角兽企业。', publishTime: '2026-04-06', aiStatement: '' },
                                { docId: 'p6', title: '经济学家圆桌：2026下半年经济展望', siteName: '财经杂志', image: '', content: '三位知名经济学家探讨2026下半年经济走势，消费复苏、房地产见底和出口挑战。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '科技前沿',
                            items: [
                                { docId: 'p7', title: '固态电池革命：电动车续航焦虑终结者', siteName: '极客公园', image: '', content: '固态电池量产在即，深入分析技术原理、量产难点以及对整个产业链的深远影响。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p8', title: '探秘量子互联网：未来通信新范式', siteName: '极客公园', image: '', content: '量子互联网和现在的互联网有何区别？用通俗语言解读量子通信技术的最新进展。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p9', title: '自动驾驶L4来了：无人出租车体验报告', siteName: '汽车之家', image: '', content: '在北京亦庄体验L4级自动驾驶出租车，全程无人干预的未来出行真实感受。', publishTime: '2026-04-06', aiStatement: '' },
                                { docId: 'p10', title: 'AI编程助手横评：谁是最强代码搭档', siteName: '少数派', image: '', content: '对主流AI编程助手进行全面横评，从代码补全到架构建议，谁是程序员最佳搭档。', publishTime: '2026-04-04', aiStatement: '' }
                            ]
                        },
                        {
                            name: '生活方式',
                            items: [
                                { docId: 'p11', title: '通勤路上的冥想课：10分钟减压指南', siteName: '小宇宙', image: '', content: '为忙碌上班族设计的通勤冥想课程，10分钟完成一次深度放松。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p12', title: '周末去哪儿：春季自驾游路线推荐', siteName: '穷游网', image: '', content: '推荐5条绝美春季自驾路线，从江南水乡到西北花海，总有一条适合你。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p13', title: '美食探店：藏在巷子里的宝藏小馆', siteName: '大众点评', image: '', content: '探访城市里藏在深巷中的宝藏餐厅，没有网红滤镜，只有最真实的味道。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '商业观察',
                            items: [
                                { docId: 'p14', title: '出海企业的本地化困境与破局', siteName: '虎嗅', image: '', content: '多家出海企业分享在东南亚和中东市场的本地化经验，文化差异和政策合规是最大挑战。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p15', title: '新消费品牌的生死线：从网红到长红', siteName: '刀法研究所', image: '', content: '剖析近年新消费品牌的兴衰规律，哪些品牌成功穿越周期，哪些沦为昙花一现。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p16', title: '供应链韧性：中国制造的新叙事', siteName: '财经十一人', image: '', content: '全球供应链重构背景下，中国制造企业如何通过技术升级和产能出海增强竞争力。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '历史人文',
                            items: [
                                { docId: 'p17', title: '丝绸之路上的失落古城', siteName: '看理想', image: '', content: '跟随考古学家的脚步，探访丝绸之路上被黄沙掩埋的古城遗址，重现千年前的繁华。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p18', title: '宋朝人的一天：穿越回汴京城', siteName: '得到', image: '', content: '如果穿越回北宋的汴京城，你会经历怎样的一天？从早市到夜市，体验宋人的日常生活。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p19', title: '大航海时代：改变世界的五次远航', siteName: '看理想', image: '', content: '从郑和下西洋到哥伦布发现新大陆，五次关键远航如何重塑了世界格局。', publishTime: '2026-04-05', aiStatement: '' }
                            ]
                        },
                        {
                            name: '亲子教育',
                            items: [
                                { docId: 'p20', title: '如何培养孩子的阅读习惯', siteName: '凯叔讲故事', image: '', content: '资深儿童教育专家分享培养孩子阅读兴趣的实用方法，从选书到陪读的全流程指南。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p21', title: '双减之后：家庭教育的新方向', siteName: '三联生活周刊', image: '', content: '双减政策实施后，家庭教育面临新的转型。如何在减负的同时保证孩子的全面发展。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p22', title: 'STEM教育实践：在家就能做的科学实验', siteName: '果壳', image: '', content: '精选10个适合亲子一起完成的科学小实验，用厨房里的材料探索物理和化学的奥秘。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        },
                        {
                            name: '音乐故事',
                            items: [
                                { docId: 'p23', title: '一首歌的诞生：周杰伦《晴天》创作内幕', siteName: 'QQ音乐', image: '', content: '揭秘华语经典歌曲《晴天》的创作过程，从灵感来源到录制完成的幕后故事。', publishTime: '2026-04-08', aiStatement: '' },
                                { docId: 'p24', title: '古典音乐入门：从莫扎特开始', siteName: '网易云音乐', image: '', content: '为古典音乐小白准备的入门指南，从莫扎特最亲切的作品开始，打开古典音乐的大门。', publishTime: '2026-04-07', aiStatement: '' },
                                { docId: 'p25', title: '中国摇滚30年：从崔健到新生代', siteName: '虾米音乐', image: '', content: '回顾中国摇滚乐30年的发展历程，从崔健的一无所有到新生代乐队的多元探索。', publishTime: '2026-04-06', aiStatement: '' }
                            ]
                        }
                    ]
                }
            ]
        };
        this.updatePlaylistUI();
        this.playAudio(0, 0, 0);
    }

    setupEventListeners() {
        try {
            // 控制按钮事件
            document.getElementById('btn-play-pause').addEventListener('click', () => this.togglePlayPause());
            document.getElementById('btn-previous').addEventListener('click', () => this.playPrevious());
            document.getElementById('btn-next').addEventListener('click', () => this.playNext());

            // 进度条事件
            document.getElementById('progress-bar').addEventListener('input', (e) => this.seek(e.target.value));

            // 功能按钮事件
            document.getElementById('btn-playlist').addEventListener('click', () => this.showPlaylist());
            if (document.getElementById('btn-audio-text')) {
                document.getElementById('btn-audio-text').addEventListener('click', () => this.showAudioText());
            }
            document.getElementById('btn-voice-control').addEventListener('click', () => this.startVoiceControl());

            // 关闭按钮事件
            if (document.getElementById('close-audio-text')) {
                document.getElementById('close-audio-text').addEventListener('click', () => this.hideAudioText());
            }
            if (document.getElementById('close-playlist')) {
                document.getElementById('close-playlist').addEventListener('click', () => this.hidePlaylist());
            }

            // 音频元素真实事件
            this.audioElement.addEventListener('timeupdate', () => this.onTimeUpdate());
            this.audioElement.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
            this.audioElement.addEventListener('ended', () => this.onEnded());
            this.audioElement.addEventListener('play', () => {
                this.isPlaying = true;
                this.updatePlayPauseIcon();
            });
            this.audioElement.addEventListener('pause', () => {
                this.isPlaying = false;
                this.updatePlayPauseIcon();
            });
        } catch (error) {
            console.error('设置事件监听器时出错:', error);
        }
    }

    // 判断音频总时长是否已知
    isDurationKnown() {
        const duration = this.audioElement.duration;
        return duration && isFinite(duration) && duration > 0;
    }

    // 更新进度条的可拖动状态
    updateProgressBarState() {
        const progressBar = document.getElementById('progress-bar');
        if (!progressBar) return;

        if (this.isDurationKnown()) {
            progressBar.disabled = false;
            progressBar.style.opacity = '1';
            progressBar.style.cursor = 'pointer';
        } else {
            progressBar.disabled = true;
            progressBar.style.opacity = '0.5';
            progressBar.style.cursor = 'not-allowed';
        }
    }

    // 音频时间更新 - 驱动进度条和时间显示
    onTimeUpdate() {
        const currentTime = this.audioElement.currentTime;
        const currentTimeEl = document.getElementById('current-time');
        if (currentTimeEl) currentTimeEl.textContent = this.formatTime(currentTime);

        const progressBar = document.getElementById('progress-bar');
        const totalTimeEl = document.getElementById('total-time');

        if (this.isDurationKnown()) {
            const duration = this.audioElement.duration;
            const progress = (currentTime / duration) * 100;
            if (progressBar) progressBar.value = progress;
            if (totalTimeEl) totalTimeEl.textContent = this.formatTime(duration);
            this.updateSubtitleHighlight(progress);
        } else {
            // 时长未知，进度条不动，总时长显示 --:--
            if (progressBar) progressBar.value = 0;
            if (totalTimeEl) totalTimeEl.textContent = '--:--';
        }

        this.updateProgressBarState();
    }

    // 音频元数据加载完成 - 显示总时长，解锁进度条
    onLoadedMetadata() {
        const totalTimeEl = document.getElementById('total-time');
        if (totalTimeEl && this.isDurationKnown()) {
            totalTimeEl.textContent = this.formatTime(this.audioElement.duration);
        }
        this.updateProgressBarState();
    }

    // 音频播放结束 - 自动切下一首
    onEnded() {
        this.playNext();
        this.play();
    }

    // 根据播放进度高亮字幕段落并滚动
    updateSubtitleHighlight(progress) {
        const subtitleContent = document.getElementById('audio-text-content');
        if (!subtitleContent) return;

        const paragraphs = subtitleContent.querySelectorAll('.subtitle-paragraph');
        if (paragraphs.length === 0) return;

        const currentIndex = Math.min(
            Math.floor((progress / 100) * paragraphs.length),
            paragraphs.length - 1
        );

        paragraphs.forEach(p => p.classList.remove('current'));

        const currentParagraph = paragraphs[currentIndex];
        if (currentParagraph) {
            currentParagraph.classList.add('current');
            const containerHeight = subtitleContent.clientHeight;
            const scrollTo = Math.max(0,
                currentParagraph.offsetTop - (containerHeight / 2) + (currentParagraph.clientHeight / 2)
            );
            subtitleContent.scrollTo({ top: scrollTo, behavior: 'smooth' });
        }
    }

    playAudio(channelIndex, categoryIndex, itemIndex) {
        try {
            console.log('playAudio被调用，channelIndex:', channelIndex, 'categoryIndex:', categoryIndex, 'itemIndex:', itemIndex);
            if (window.savePlayPosition) {
                window.savePlayPosition();
            }

            const channels = this.audioData.channels;
            if (channelIndex < 0 || channelIndex >= channels.length) return;
            const channel = channels[channelIndex];
            if (categoryIndex < 0 || categoryIndex >= channel.categories.length) return;
            const category = channel.categories[categoryIndex];
            if (itemIndex < 0 || itemIndex >= category.items.length) return;

            this.currentChannelIndex = channelIndex;
            this.currentCategoryIndex = categoryIndex;
            this.currentItemIndex = itemIndex;
            const audioItem = category.items[itemIndex];
            // 通过 fetch 流式加载音频，避免浏览器自动发 Range 请求导致连接中断
            if (audioItem.docId) {
                this._fetchAudioStream(audioItem.docId);
            }
            this.updateAudioInfo(audioItem);
            this.updatePlaylistUI();

            // 重置进度条和时间显示
            const progressBar = document.getElementById('progress-bar');
            const currentTimeEl = document.getElementById('current-time');
            const totalTimeEl = document.getElementById('total-time');
            if (progressBar) progressBar.value = 0;
            if (currentTimeEl) currentTimeEl.textContent = '00:00';
            if (totalTimeEl) totalTimeEl.textContent = '--:--';
            // 流式音频加载中，禁用进度条拖动
            this.updateProgressBarState();
        } catch (error) {
            console.error('playAudio执行失败:', error);
        }
    }

    _fetchAudioStream(docId) {
        // 取消上一次正在进行的请求
        if (this._audioAbortController) {
            this._audioAbortController.abort();
        }
        this._audioAbortController = new AbortController();

        // 清理上一次的 MediaSource
        if (this._mediaSource) {
            if (this._mediaSource.readyState === 'open') {
                try { this._mediaSource.endOfStream(); } catch (e) {}
            }
            this._mediaSource = null;
        }
        if (this._audioBlobUrl) {
            URL.revokeObjectURL(this._audioBlobUrl);
            this._audioBlobUrl = null;
        }

        const signal = this._audioAbortController.signal;

        // 检测浏览器是否支持 MediaSource + audio/mpeg
        if (window.MediaSource && MediaSource.isTypeSupported('audio/mpeg')) {
            this._streamWithMediaSource(docId, signal);
        } else {
            // 降级：全量加载后播放
            this._streamWithBlobFallback(docId, signal);
        }
    }

    _streamWithMediaSource(docId, signal) {
        const mediaSource = new MediaSource();
        this._mediaSource = mediaSource;
        this._audioBlobUrl = URL.createObjectURL(mediaSource);
        this.audioElement.src = this._audioBlobUrl;

        mediaSource.addEventListener('sourceopen', () => {
            const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
            const queue = [];
            let streamDone = false;

            const appendNext = () => {
                if (sourceBuffer.updating || mediaSource.readyState !== 'open') return;
                if (queue.length > 0) {
                    sourceBuffer.appendBuffer(queue.shift());
                } else if (streamDone) {
                    try { mediaSource.endOfStream(); } catch (e) {}
                }
            };

            sourceBuffer.addEventListener('updateend', appendNext);

            fetch('/api/audio-stream?docId=' + encodeURIComponent(docId), { signal })
                .then((response) => {
                    if (!response.ok) throw new Error('音频请求失败: ' + response.status);
                    const reader = response.body.getReader();

                    const read = () => reader.read().then((result) => {
                        if (result.done) {
                            streamDone = true;
                            appendNext();
                            return;
                        }
                        queue.push(result.value);
                        appendNext();
                        return read();
                    });

                    return read();
                })
                .catch((err) => {
                    if (err.name === 'AbortError') return;
                    console.error('音频流加载失败:', err);
                });
        });
    }

    _streamWithBlobFallback(docId, signal) {
        fetch('/api/audio-stream?docId=' + encodeURIComponent(docId), { signal })
            .then((response) => {
                if (!response.ok) throw new Error('音频请求失败: ' + response.status);
                const reader = response.body.getReader();
                const chunks = [];

                const read = () => reader.read().then((result) => {
                    if (result.done) {
                        const blob = new Blob(chunks, { type: 'audio/mpeg' });
                        this._audioBlobUrl = URL.createObjectURL(blob);
                        this.audioElement.src = this._audioBlobUrl;
                        this.audioElement.load();
                        return;
                    }
                    chunks.push(result.value);
                    return read();
                });

                return read();
            })
            .catch((err) => {
                if (err.name === 'AbortError') return;
                console.error('音频流加载失败:', err);
            });
    }

    updateAudioInfo(audioItem) {
        document.getElementById('audio-title').textContent = audioItem.title;
        document.getElementById('audio-subtitle').textContent = audioItem.siteName || '';

        // 更新字幕区内容，将文本分割为段落
        const audioTextContent = document.getElementById('audio-text-content');
        audioTextContent.innerHTML = '';

        // 将内容按句分割为段落
        const sentences = audioItem.content.split('。').filter(s => s.trim() !== '');
        sentences.forEach((sentence, index) => {
            const paragraph = document.createElement('p');
            paragraph.className = 'subtitle-paragraph';
            paragraph.textContent = sentence + '。';
            paragraph.dataset.index = index;
            audioTextContent.appendChild(paragraph);
        });
    }

    updatePlaylistUI() {
        try {
            const tabButtonsContainer = document.getElementById('tab-buttons');
            const tabContentsContainer = document.getElementById('tab-contents');

            if (!tabButtonsContainer || !tabContentsContainer) {
                console.error('播放列表容器元素不存在');
                return;
            }

            tabButtonsContainer.innerHTML = '';
            tabContentsContainer.innerHTML = '';

            if (!this.audioData || !this.audioData.channels) {
                console.error('音频数据不存在');
                return;
            }

            // 第一层：栏目 tab（新闻资讯 / 播客）
            this.audioData.channels.forEach((channel, channelIndex) => {
                const channelTab = document.createElement('button');
                channelTab.className = 'tab-button';
                channelTab.textContent = channel.name;
                if (channelIndex === this.currentChannelIndex) {
                    channelTab.classList.add('active');
                }

                channelTab.addEventListener('click', () => {
                    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
                    channelTab.classList.add('active');
                    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
                    document.querySelector(`.tab-content[data-channel-index="${channelIndex}"]`).style.display = 'block';
                });

                tabButtonsContainer.appendChild(channelTab);

                // 栏目内容区
                const channelContent = document.createElement('div');
                channelContent.className = 'tab-content';
                channelContent.dataset.channelIndex = channelIndex;
                channelContent.style.display = channelIndex === this.currentChannelIndex ? 'block' : 'none';

                // 第二层：分类 tab（时政、科技... / 今日大事、订阅...）
                const categoryTabsContainer = document.createElement('div');
                categoryTabsContainer.className = 'category-tabs';

                const categoryContentsContainer = document.createElement('div');
                categoryContentsContainer.className = 'category-contents';

                channel.categories.forEach((category, categoryIndex) => {
                    // 分类 tab 按钮
                    const catTab = document.createElement('button');
                    catTab.className = 'category-tab';
                    catTab.textContent = category.name;
                    if (channelIndex === this.currentChannelIndex && categoryIndex === this.currentCategoryIndex) {
                        catTab.classList.add('active');
                    }

                    catTab.addEventListener('click', () => {
                        categoryTabsContainer.querySelectorAll('.category-tab').forEach(btn => btn.classList.remove('active'));
                        catTab.classList.add('active');
                        categoryContentsContainer.querySelectorAll('.category-content').forEach(c => c.style.display = 'none');
                        categoryContentsContainer.querySelector(`.category-content[data-category-index="${categoryIndex}"]`).style.display = 'block';
                    });

                    categoryTabsContainer.appendChild(catTab);

                    // 分类内容：item 列表
                    const catContent = document.createElement('div');
                    catContent.className = 'category-content';
                    catContent.dataset.categoryIndex = categoryIndex;
                    const isActiveCat = channelIndex === this.currentChannelIndex && categoryIndex === this.currentCategoryIndex;
                    catContent.style.display = isActiveCat ? 'block' : 'none';

                    const audioList = document.createElement('ul');
                    audioList.className = 'audio-list';

                    category.items.forEach((item, itemIndex) => {
                        const listItem = document.createElement('li');
                        listItem.className = 'audio-item';

                        if (channelIndex === this.currentChannelIndex &&
                            categoryIndex === this.currentCategoryIndex &&
                            itemIndex === this.currentItemIndex) {
                            listItem.classList.add('active');
                        }

                        listItem.addEventListener('click', () => {
                            this.playAudio(channelIndex, categoryIndex, itemIndex);
                            this.play();
                        });

                        const audioInfo = document.createElement('div');
                        audioInfo.className = 'audio-item-info';

                        const audioTitle = document.createElement('h4');
                        audioTitle.textContent = item.title;

                        const audioSource = document.createElement('p');
                        audioSource.textContent = item.siteName || '';

                        audioInfo.appendChild(audioTitle);
                        audioInfo.appendChild(audioSource);
                        listItem.appendChild(audioInfo);
                        audioList.appendChild(listItem);
                    });

                    catContent.appendChild(audioList);
                    categoryContentsContainer.appendChild(catContent);
                });

                channelContent.appendChild(categoryTabsContainer);
                channelContent.appendChild(categoryContentsContainer);
                tabContentsContainer.appendChild(channelContent);
            });
        } catch (error) {
            console.error('更新播放列表UI时出错:', error);
        }
    }

    togglePlayPause() {
        console.log('togglePlayPause被调用，当前isPlaying状态:', this.isPlaying);
        if (this.isPlaying) {
            console.log('当前正在播放，调用pause()');
            this.pause();
        } else {
            console.log('当前正在暂停，调用play()');
            this.play();
        }
    }

    play() {
        this.audioElement.play().catch(error => {
            console.error('音频播放失败:', error);
        });
    }

    pause() {
        this.audioElement.pause();
    }

    // 获取当前分类的 items
    getCurrentCategory() {
        return this.audioData.channels[this.currentChannelIndex].categories[this.currentCategoryIndex];
    }

    playPrevious() {
        const category = this.getCurrentCategory();
        if (this.currentItemIndex > 0) {
            // 当前分类内切到上一条
            this.playAudio(this.currentChannelIndex, this.currentCategoryIndex, this.currentItemIndex - 1);
        } else {
            // 切到上一个分类的最后一条（在同一栏目内循环）
            const channel = this.audioData.channels[this.currentChannelIndex];
            const newCatIndex = (this.currentCategoryIndex - 1 + channel.categories.length) % channel.categories.length;
            const newCat = channel.categories[newCatIndex];
            this.playAudio(this.currentChannelIndex, newCatIndex, newCat.items.length - 1);
        }
        if (this.isPlaying) {
            this.play();
        }
    }

    playNext() {
        const category = this.getCurrentCategory();
        if (this.currentItemIndex < category.items.length - 1) {
            // 当前分类内切到下一条
            this.playAudio(this.currentChannelIndex, this.currentCategoryIndex, this.currentItemIndex + 1);
        } else {
            // 切到下一个分类的第一条（在同一栏目内循环）
            const channel = this.audioData.channels[this.currentChannelIndex];
            const newCatIndex = (this.currentCategoryIndex + 1) % channel.categories.length;
            this.playAudio(this.currentChannelIndex, newCatIndex, 0);
        }
        if (this.isPlaying) {
            this.play();
        }
    }

    seek(value) {
        if (!this.isDurationKnown()) return;
        this.audioElement.currentTime = this.audioElement.duration * (value / 100);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    updatePlayPauseIcon() {
        const playPauseBtn = document.getElementById('btn-play-pause');
        if (!playPauseBtn) return;

        const icon = playPauseBtn.querySelector('i');
        if (!icon) return;

        icon.className = this.isPlaying ? 'fas fa-pause' : 'fas fa-play';
    }

    showPlaylist() {
        const playlistModal = document.getElementById('playlist-modal');
        playlistModal.style.display = 'block';
    }

    hidePlaylist() {
        const playlistModal = document.getElementById('playlist-modal');
        playlistModal.style.display = 'none';
    }

    showAudioText() {
        // 内容详情已在主界面常驻显示
    }

    hideAudioText() {
        // 内容详情已在主界面常驻显示
    }

    startVoiceControl() {
        const voiceControlHint = document.getElementById('voice-control-hint');
        if (!voiceControlHint) return;
        voiceControlHint.style.display = 'flex';
        setTimeout(() => {
            voiceControlHint.style.display = 'none';
        }, 3000);
    }
}