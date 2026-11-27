// DK Kinehall ATSC 1.0 helper. Backend ported from DK Media Plus.
#include "tuner_backend.hpp"
#include <iostream>
#include <algorithm>
#include <iomanip>
#include <cstdlib>
#include <regex>
#include <string>
#include <vector>
#include <stdexcept>
using namespace reddmedia;
static void quoted(const std::string& text){
    std::cout << '"';
    for(unsigned char c:text){
        if(c=='"'||c=='\\') std::cout << '\\' << c;
        else if(c<32 || c>=127) std::cout << "\\u00" << std::hex << std::setw(2) << std::setfill('0') << unsigned(c) << std::dec;
        else std::cout << c;
    }
    std::cout << '"';
}
static void output(const std::vector<LiveTvChannel>& channels,const std::vector<LiveTvProgram>& programs){
    std::cout << "{\"channels\":[";
    bool first=true;
    for(const auto& c:channels){
        if(!first)std::cout << ',';
        first=false;
        std::cout << "{\"number\":";quoted(c.id);std::cout << ",\"name\":";quoted(c.name);
        std::cout << ",\"frequency\":";quoted(c.frequency);
        std::cout << ",\"program\":" << c.program_number << ",\"sourceId\":" << c.source_id << '}';
    }
    std::cout << "],\"programs\":[";
    first=true;
    for(const auto& p:programs){
        if(!first)std::cout << ',';
        first=false;
        std::cout << "{\"number\":";quoted(p.channel_id);std::cout << ",\"title\":";quoted(p.title);
        std::cout << ",\"desc\":";quoted(p.description);
        std::cout << ",\"start\":" << p.start_unix << ",\"end\":" << p.start_unix+p.duration_seconds << '}';
    }
    std::cout << "]}\n";
}
int main(int argc,char** argv){
    if(argc!=4)return 2;
    const std::string action=argv[1],device=argv[2],cache=argv[3];
    if((action!="scan"&&action!="guide"&&action!="cached")||
        !std::regex_match(device,std::regex("adapter[0-9]{1,4}/frontend[0-9]{1,4}"))||cache.empty()||cache[0]!='/')return 2;
    if(setenv("XDG_CONFIG_HOME",cache.c_str(),1)!=0)return 2;
    try{
        NougatTunerBackend backend;
        auto channels=backend.load_channels();auto programs=backend.load_guide();
        if(action!="cached"){
            std::string status;
            auto tuners=backend.detect(status);
            auto it=std::find_if(tuners.begin(),tuners.end(),[&](const TunerDevice& t){return t.id==device&&t.backend=="Linux DVB"&&t.readable;});
            if(it==tuners.end()){std::cerr<<"Tuner unavailable\n";return 3;}
            const auto callback=[](const ChannelScanProgress& p){
                std::cerr << "PROGRESS " << p.completed << ' ' << p.total << ' ' << p.channels_found << '\n' << std::flush;
                return true;
            };
            bool ok=action=="scan"?backend.scan_channels(*it,channels,status,callback):backend.refresh_guide(*it,channels,programs,status,callback);
            if(!ok){std::cerr<<status<<'\n';return 4;}
            if(action=="scan"){programs.clear();std::string error;if(!backend.save_guide(programs,error)){std::cerr<<error<<'\n';return 4;}}
        }
        output(channels,programs);
        return 0;
    }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 5;}
}
