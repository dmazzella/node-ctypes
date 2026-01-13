#pragma once

#include <string>
#include <cstdlib>
#include <fstream>
#include <algorithm>
#include <functional>
#include <cctype>

#define DOTENV_VERSION_MAJOR 1
#define DOTENV_VERSION_MINOR 0
#define DOTENV_VERSION_PATCH 0

///
/// Utility class for loading environment variables from a file and setting them.
///
/// ### Typical use
///
/// Given a file `.env`
///
/// DATABASE_HOST=localhost
/// DATABASE_USERNAME=user
/// DATABASE_PASSWORD="antipasto"
///
/// and a program `example.cpp`
///
/// // example.cpp
/// #include <iostream>
/// #include <dotenv.h>
///
/// int main()
/// {
///     dotenv::init();
///
///     std::cout << std::getenv("DATABASE_USERNAME") << std::endl;
///     std::cout << std::getenv("DATABASE_PASSWORD") << std::endl;
///
///     return 0;
/// }

class dotenv
{
public:
    dotenv() = delete;
    ~dotenv() = delete;

    static const unsigned char Preserve = 1 << 0;

    static const int OptionsNone = 0;

    static void init(const char *filename = ".env");
    static void init(int flags, const char *filename = ".env");

    static std::string getenv(const char *name, const std::string &def = "");

private:
    static void do_init(int flags, const char *filename);
    static std::string strip_quotes(const std::string &str);

    static std::pair<std::string, bool> resolve_vars(size_t iline, const std::string &str);
    static void ltrim(std::string &s);
    static void rtrim(std::string &s);
    static void trim(std::string &s);
    static std::string trim_copy(std::string s);
    static size_t find_var_start(const std::string &str, size_t pos, std::string &start_tag);
    static size_t find_var_end(const std::string &str, size_t pos, const std::string &start_tag);
};

inline void dotenv::init(const char *filename)
{
    dotenv::do_init(OptionsNone, filename);
}

inline void dotenv::init(int flags, const char *filename)
{
    dotenv::do_init(flags, filename);
}

inline std::string dotenv::getenv(const char *name, const std::string &def)
{
    const char *str = std::getenv(name);
    return str ? std::string(str) : def;
}

#if defined(_MSC_VER) || defined(__MINGW32__)

// https://stackoverflow.com/questions/17258029/c-setenv-undefined-identifier-in-visual-studio
inline int setenv(const char *name, const char *value, int overwrite)
{
    int errcode = 0;

    if (!overwrite)
    {
        size_t envsize = 0;
        errcode = getenv_s(&envsize, NULL, 0, name);
        if (errcode || envsize)
            return errcode;
    }
    return _putenv_s(name, value);
}

#endif // _MSC_VER

inline size_t dotenv::find_var_start(const std::string &str, size_t pos, std::string &start_tag)
{
    size_t p1 = str.find('$', pos);
    size_t p2 = str.find("${", pos);
    size_t pos_var = (std::min)(p1, p2);
    if (pos_var != std::string::npos)
        start_tag = (pos_var == p2) ? "${" : "$";
    return pos_var;
}

inline size_t dotenv::find_var_end(const std::string &str, size_t pos, const std::string &start_tag)
{
    char end_tag = (start_tag == "${") ? '}' : ' ';
    size_t pos_end = str.find(end_tag, pos);
    // special case when $VARIABLE is at end of str with no trailing whitespace
    if (pos_end == std::string::npos && end_tag == ' ')
        pos_end = str.length();
    return pos_end;
}

// trim whitespace from left (in place)
inline void dotenv::ltrim(std::string &s)
{
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), [](int c)
                                    { return !std::isspace(c); }));
}

// trim whitespace from right (in place)
inline void dotenv::rtrim(std::string &s)
{
    s.erase(
        std::find_if(
            s.rbegin(), s.rend(),
            [](int c)
            { return !std::isspace(c); })
            .base(),
        s.end());
}

// trim both ends (in place)
inline void dotenv::trim(std::string &s)
{
    ltrim(s);
    rtrim(s);
}

// trim from both ends (copying)
inline std::string dotenv::trim_copy(std::string s)
{
    trim(s);
    return s;
}

inline std::pair<std::string, bool> dotenv::resolve_vars(size_t iline, const std::string &str)
{
    std::string resolved;

    size_t pos = 0;
    size_t pre_pos = pos;
    size_t nvar = 0;

    bool finished = false;
    while (!finished)
    {
        // look for start of variable expression after pos
        std::string start_tag;
        pos = find_var_start(str, pos, start_tag);
        if (pos != std::string::npos)
        {
            // a variable definition detected
            nvar++;

            // keep start of variable expression
            size_t pos_start = pos;

            size_t lstart = start_tag.length(); // length of start tag
            size_t lend = (lstart > 1) ? 1 : 0; // length of end tag

            // add substring since last variable
            resolved += str.substr(pre_pos, pos - pre_pos);

            // look for end of variable expression
            pos = find_var_end(str, pos, start_tag);
            if (pos != std::string::npos)
            {
                // variable name with decoration
                std::string var = str.substr(pos_start, pos - pos_start + 1);

                // variable name without decoration
                std::string env_var = var.substr(lstart, var.length() - lstart - lend);

                // remove possible whitespace at the end
                rtrim(env_var);

                // evaluate environment variable
                if (const char *env_str = std::getenv(env_var.c_str()))
                {
                    resolved += env_str;
                    nvar--; // decrement to indicate variable resolved
                }
                else
                {
                    // could not resolve the variable, so don't decrement
                }

                // skip end tag
                pre_pos = pos + lend;
            }
        }
        else
        {
            // no more variables
            finished = true;
        }
    }

    // add possible trailing non-whitespace after last variable
    if (pre_pos < str.length())
    {
        resolved += str.substr(pre_pos);
    }

    // nvar must be 0, or else we have an error
    return std::make_pair(resolved, (nvar == 0));
}

inline void dotenv::do_init(int flags, const char *filename)
{
    std::ifstream file;
    std::string line;

    file.open(filename);

    if (file)
    {
        unsigned int i = 1;

        while (getline(file, line))
        {
            const auto len = line.length();
            if (len == 0 || line[0] == '#')
            {
                continue;
            }

            const auto pos = line.find("=");

            if (pos == std::string::npos)
            {
                // ill-formed line, no '=' character
            }
            else
            {
                auto name = trim_copy(line.substr(0, pos));
                auto value_part = line.substr(pos + 1);

                // Trim only leading whitespace before checking for quotes
                ltrim(value_part);

                // Check if value starts with a quote
                if (!value_part.empty() && (value_part[0] == '"' || value_part[0] == '\''))
                {
                    char quote_char = value_part[0];

                    // Check if the quote is closed on the same line
                    bool quote_closed = false;
                    size_t closing_quote_pos = std::string::npos;

                    if (value_part.length() > 1)
                    {
                        // Look for closing quote (skip the opening quote at position 0)
                        for (size_t j = 1; j < value_part.length(); ++j)
                        {
                            if (value_part[j] == quote_char)
                            {
                                // Count consecutive backslashes before this quote
                                size_t num_backslashes = 0;
                                size_t k = j - 1;
                                while (k > 0 && value_part[k] == '\\')
                                {
                                    num_backslashes++;
                                    k--;
                                }

                                // If even number of backslashes (including 0), quote is not escaped
                                if (num_backslashes % 2 == 0)
                                {
                                    quote_closed = true;
                                    closing_quote_pos = j;
                                    break;
                                }
                            }
                        }
                    }

                    // If quote is closed on same line, trim everything after closing quote
                    if (quote_closed && closing_quote_pos != std::string::npos)
                    {
                        value_part = value_part.substr(0, closing_quote_pos + 1);
                    }

                    // If quote is not closed, read additional lines
                    if (!quote_closed)
                    {
                        std::string multiline_value = value_part;
                        std::string next_line;

                        while (getline(file, next_line))
                        {
                            ++i;
                            multiline_value += "\n" + next_line;

                            // Check if this line contains the closing quote
                            for (size_t j = 0; j < next_line.length(); ++j)
                            {
                                if (next_line[j] == quote_char)
                                {
                                    // Count consecutive backslashes before this quote
                                    size_t num_backslashes = 0;
                                    if (j > 0)
                                    {
                                        size_t k = j - 1;
                                        while (k < next_line.length() && next_line[k] == '\\')
                                        {
                                            num_backslashes++;
                                            if (k == 0)
                                                break;
                                            k--;
                                        }
                                    }

                                    // If even number of backslashes, quote is not escaped
                                    if (num_backslashes % 2 == 0)
                                    {
                                        quote_closed = true;
                                        break;
                                    }
                                }
                            }

                            if (quote_closed)
                            {
                                break;
                            }
                        }

                        value_part = multiline_value;
                    }
                }
                else
                {
                    // For non-quoted values, trim trailing whitespace and remove inline comments
                    // Find first # that is not inside quotes (simple approach: just find first #)
                    size_t comment_pos = value_part.find('#');
                    if (comment_pos != std::string::npos)
                    {
                        value_part = value_part.substr(0, comment_pos);
                    }
                    rtrim(value_part);
                }

                auto line_stripped = strip_quotes(value_part);

                // resolve any contained variable expressions in 'line_stripped'
                auto p = resolve_vars(i, line_stripped);
                bool ok = p.second;
                if (!ok)
                {
                    // could not resolve all variables
                }
                else
                {

                    // variable resolved ok, set as environment variable
                    const auto &val = p.first;
                    setenv(name.c_str(), val.c_str(), ~flags & dotenv::Preserve);
                }
            }
            ++i;
        }
    }
}

inline std::string dotenv::strip_quotes(const std::string &str)
{
    const std::size_t len = str.length();

    if (len < 2)
        return str;

    const char first = str[0];

    // For quoted strings, find the last occurrence of the matching quote
    if (first == '"' || first == '\'')
    {
        // Find last non-escaped quote of the same type
        for (std::size_t i = len - 1; i > 0; --i)
        {
            if (str[i] == first)
            {
                // Count consecutive backslashes before this quote
                size_t num_backslashes = 0;
                if (i > 0)
                {
                    size_t k = i - 1;
                    while (k < str.length() && str[k] == '\\')
                    {
                        num_backslashes++;
                        if (k == 0)
                            break;
                        k--;
                    }
                }

                // If even number of backslashes, quote is not escaped
                if (num_backslashes % 2 == 0)
                {
                    // Found matching closing quote
                    return str.substr(1, i - 1);
                }
            }
        }
    }

    return str;
}